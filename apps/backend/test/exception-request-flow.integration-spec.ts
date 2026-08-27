import { ConfigService } from "@nestjs/config";
import { ExceptionStatus, Role } from "@prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { ExceptionReconcileSettings } from "../src/exception-lifecycle/exception-reconcile.settings";
import { ExceptionLifecycleService } from "../src/exception-lifecycle/exception-lifecycle.service";
import { EXCEPTION_REQUEST_ERROR } from "../src/exception-requests/exception-request.errors";
import { ExceptionRequestsService } from "../src/exception-requests/exception-requests.service";
import { GitOpsPublisherService } from "../src/gitops/gitops-publisher.service";
import { KyvernoAdapter } from "../src/kubernetes/kyverno.adapter";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  buildFakeClusterProvider,
  FakeClusterProvider,
} from "./support/fake-cluster-provider";

const KYVERNO_GROUP = "kyverno.io";
const EXCEPTION_VERSION = "v2beta1";
const EXCEPTION_PLURAL = "policyexceptions";

describe("policy exception request flow (real adapter, fake cluster)", () => {
  let prisma: PrismaService;
  let clusters: FakeClusterProvider;
  let service: ExceptionRequestsService;

  beforeAll(() => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL must be provided by the disposable PostgreSQL container.",
      );
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
  });

  beforeEach(async () => {
    clusters = buildFakeClusterProvider([
      {
        id: "prod",
        displayName: "Production",
        exceptionNamespace: "kyverno-prod",
        policyRules: ["validate-image-tag"],
        autogenRules: ["autogen-validate-image-tag"],
      },
      {
        id: "staging",
        displayName: "Staging",
        exceptionNamespace: "kyverno-staging",
        policyRules: ["validate-image-tag"],
        autogenRules: ["autogen-validate-image-tag"],
      },
    ]);
    const kyverno = new KyvernoAdapter(clusters);
    const settings = {
      claimTtlSeconds: 60,
      approvedRecheckIntervalSeconds: 300,
    } as ExceptionReconcileSettings;
    const lifecycle = new ExceptionLifecycleService(prisma, kyverno, settings);
    const config = {
      get: () => undefined,
    } as unknown as ConfigService;
    const gitOpsPublisher = {
      publishManifest: jest.fn().mockResolvedValue({
        publishedToGitOps: false,
        appliedDirectly: true,
      }),
    } as unknown as GitOpsPublisherService;
    service = new ExceptionRequestsService(
      prisma,
      lifecycle,
      clusters,
      kyverno,
      gitOpsPublisher,
      config,
    );

    await cleanup();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("creates the PolicyException manifest on the target cluster after approval", async () => {
    const { requester, approver } = await createActors("flow");
    const created = await service.create(
      {
        policyName: "disallow-latest-tag",
        ruleNames: ["validate-image-tag"],
        reason: "emergency rollback",
        resourceKind: "Deployment",
        resourceName: "api",
        resourceNamespace: "production",
        targetClusterId: "prod",
        expiresAt: futureIso(),
      },
      requester,
    );
    expect(created.status).toBe(ExceptionStatus.PENDING);

    await service.approve(created.id, {}, approver);

    const prodApi = clusters.apiFor("prod");
    expect(prodApi.createNamespacedCustomObject).toHaveBeenCalledTimes(1);
    const [createRequest] = prodApi.createNamespacedCustomObject.mock.calls[0];
    expect(createRequest).toMatchObject({
      group: KYVERNO_GROUP,
      version: EXCEPTION_VERSION,
      namespace: "kyverno-prod",
      plural: EXCEPTION_PLURAL,
    });
    const manifest = createRequest.body;
    expect(manifest).toMatchObject({
      kind: "PolicyException",
      metadata: {
        name: created.k8sExceptionName,
        namespace: "kyverno-prod",
        labels: {
          "app.kubernetes.io/managed-by": "pac-kyverno-dashboard",
          "pac.kyverno.io/request-id": created.id,
        },
      },
      spec: {
        exceptions: [
          {
            policyName: "disallow-latest-tag",
            ruleNames: ["validate-image-tag", "autogen-validate-image-tag"],
          },
        ],
      },
    });
    expect(manifest.spec.match.any).toEqual(
      expect.arrayContaining([
        {
          resources: {
            kinds: ["Deployment"],
            names: ["api"],
            namespaces: ["production"],
          },
        },
        {
          resources: {
            kinds: ["Pod"],
            names: ["api-*"],
            namespaces: ["production"],
          },
        },
      ]),
    );

    const stored = await prisma.policyExceptionRequest.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(stored).toMatchObject({
      status: ExceptionStatus.APPROVED,
      appliedRuleNames: ["validate-image-tag", "autogen-validate-image-tag"],
    });
  });

  it("routes each request to its own target cluster", async () => {
    const { requester, approver } = await createActors("multi");

    for (const clusterId of ["prod", "staging"]) {
      const created = await service.create(
        {
          policyName: "disallow-latest-tag",
          ruleNames: ["validate-image-tag"],
          reason: `exception for ${clusterId}`,
          resourceKind: "Deployment",
          resourceName: "api",
          resourceNamespace: "production",
          targetClusterId: clusterId,
          expiresAt: futureIso(),
        },
        requester,
      );
      await service.approve(created.id, {}, approver);
    }

    const prodApi = clusters.apiFor("prod");
    const stagingApi = clusters.apiFor("staging");
    expect(prodApi.createNamespacedCustomObject).toHaveBeenCalledTimes(1);
    expect(stagingApi.createNamespacedCustomObject).toHaveBeenCalledTimes(1);
    expect(
      prodApi.createNamespacedCustomObject.mock.calls[0][0].namespace,
    ).toBe("kyverno-prod");
    expect(
      stagingApi.createNamespacedCustomObject.mock.calls[0][0].namespace,
    ).toBe("kyverno-staging");
  });

  it("rejects approval when a requested rule is unknown to the policy", async () => {
    const { requester, approver } = await createActors("bad-rule");
    const created = await service.create(
      {
        policyName: "disallow-latest-tag",
        ruleNames: ["does-not-exist"],
        reason: "typo rule",
        resourceKind: "Deployment",
        resourceName: "api",
        resourceNamespace: "production",
        targetClusterId: "prod",
        expiresAt: futureIso(),
      },
      requester,
    );

    await expect(
      service.approve(created.id, {}, approver),
    ).rejects.toMatchObject({
      code: EXCEPTION_REQUEST_ERROR.POLICY_RULE_VALIDATION_FAILED.code,
    });
    expect(
      clusters.apiFor("prod").createNamespacedCustomObject,
    ).not.toHaveBeenCalled();
  });

  it("deletes the PolicyException when the request is cancelled", async () => {
    const { requester, approver } = await createActors("cancel");
    const created = await service.create(
      {
        policyName: "disallow-latest-tag",
        ruleNames: ["validate-image-tag"],
        reason: "will cancel",
        resourceKind: "Deployment",
        resourceName: "api",
        resourceNamespace: "production",
        targetClusterId: "prod",
        expiresAt: futureIso(),
      },
      requester,
    );
    await service.approve(created.id, {}, approver);
    await service.cancel(created.id, requester);

    const prodApi = clusters.apiFor("prod");
    expect(prodApi.deleteNamespacedCustomObject).toHaveBeenCalledTimes(1);
    expect(prodApi.deleteNamespacedCustomObject.mock.calls[0][0]).toMatchObject(
      {
        group: KYVERNO_GROUP,
        version: EXCEPTION_VERSION,
        namespace: "kyverno-prod",
        plural: EXCEPTION_PLURAL,
        name: created.k8sExceptionName,
      },
    );
    await expect(
      prisma.policyExceptionRequest.findUniqueOrThrow({
        where: { id: created.id },
      }),
    ).resolves.toMatchObject({ status: ExceptionStatus.CANCELLED });
  });

  async function createActors(suffix: string): Promise<{
    requester: AuthenticatedUser;
    approver: AuthenticatedUser;
  }> {
    const requester = await prisma.user.create({
      data: {
        email: `requester-${suffix}@example.com`,
        pwdHash: "hash",
        role: Role.REQUESTER,
      },
    });
    const approver = await prisma.user.create({
      data: {
        email: `approver-${suffix}@example.com`,
        pwdHash: "hash",
        role: Role.APPROVER,
      },
    });
    return {
      requester: {
        id: requester.id,
        email: requester.email,
        role: Role.REQUESTER,
        clusterIds: ["prod", "staging"],
      },
      approver: {
        id: approver.id,
        email: approver.email,
        role: Role.APPROVER,
        clusterIds: ["prod", "staging"],
      },
    };
  }

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany();
    await prisma.policyExceptionRequest.deleteMany();
    await prisma.user.deleteMany();
  }
});

function futureIso(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}
