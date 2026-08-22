import { ConfigService } from "@nestjs/config";
import { ExceptionStatus, PolicyExceptionRequest, Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { EXCEPTION_LIFECYCLE_ERROR } from "../exception-lifecycle/exception-lifecycle.errors";
import { ExceptionLifecycleService } from "../exception-lifecycle/exception-lifecycle.service";
import { GitOpsPublisherService } from "../gitops/gitops-publisher.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { KUBERNETES_ERROR } from "../kubernetes/kubernetes.errors";
import { PrismaService } from "../prisma/prisma.service";
import { EXCEPTION_REQUEST_ERROR } from "./exception-request.errors";
import { ExceptionRequestsService } from "./exception-requests.service";

const requester: AuthenticatedUser = {
  id: "requester-1",
  email: "requester@example.com",
  role: Role.REQUESTER,
  clusterIds: ["local"],
};
const approver: AuthenticatedUser = {
  id: "approver-1",
  email: "approver@example.com",
  role: Role.APPROVER,
  clusterIds: ["local"],
};
const admin: AuthenticatedUser = {
  id: "admin-1",
  email: "admin@example.com",
  role: Role.ADMIN,
  clusterIds: ["local"],
};
const viewer: AuthenticatedUser = {
  id: "viewer-1",
  email: "viewer@example.com",
  role: Role.VIEWER,
  clusterIds: ["local"],
};

function record(
  overrides: Partial<PolicyExceptionRequest> = {},
): PolicyExceptionRequest {
  const now = new Date();
  return {
    id: "request-1",
    status: ExceptionStatus.PENDING,
    reason: "reason",
    policyName: "policy",
    ruleNames: ["rule"],
    appliedRuleNames: [],
    resourceKind: "Pod",
    resourceName: "api",
    resourceNamespace: "default",
    targetClusterId: "local",
    targetClusterDisplayName: "Local",
    k8sExceptionName: "pac-exception-request-1",
    expiresAt: new Date(now.getTime() + 60_000),
    decisionNote: null,
    decidedAt: null,
    activatedAt: null,
    applyAttempts: 0,
    lastError: null,
    nextAttemptAt: null,
    createdAt: now,
    updatedAt: now,
    requestUserId: requester.id,
    approverUserId: null,
    ...overrides,
  };
}

function harness(found: PolicyExceptionRequest | null = record()) {
  const prisma = {
    policyExceptionRequest: {
      findMany: jest.fn().mockResolvedValue(found ? [found] : []),
      findFirst: jest.fn().mockImplementation(async ({ where }) => {
        if (!found || found.id !== where.id) return null;
        if (
          where.requestUserId &&
          where.requestUserId !== found.requestUserId
        ) {
          return null;
        }
        if (
          where.targetClusterId?.in &&
          !where.targetClusterId.in.includes(found.targetClusterId)
        ) {
          return null;
        }
        return found;
      }),
      findUnique: jest.fn().mockResolvedValue(found),
    },
  } as unknown as PrismaService;
  const lifecycle = {
    approve: jest.fn().mockResolvedValue(found),
    reject: jest.fn().mockResolvedValue(found),
    cancel: jest.fn().mockResolvedValue(found),
  } as unknown as ExceptionLifecycleService;
  const clusters = {
    getMetadata: jest.fn().mockReturnValue({
      id: "local",
      displayName: "Local",
      exceptionNamespace: "kyverno",
    }),
  } as unknown as ClusterProvider;
  const kyverno = {
    resolveRuleNames: jest.fn().mockResolvedValue(["rule"]),
  } as unknown as KyvernoAdapter;
  const gitOpsPublisher = {
    publishManifest: jest.fn().mockResolvedValue({
      publishedToGitOps: true,
      appliedDirectly: true,
      filePath: "k8s-manifests/exceptions/default/request-1.yaml",
    }),
  } as unknown as GitOpsPublisherService;
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;

  return {
    service: new ExceptionRequestsService(
      prisma,
      lifecycle,
      clusters,
      kyverno,
      gitOpsPublisher,
      config,
    ),
    prisma: prisma as unknown as {
      policyExceptionRequest: {
        findMany: jest.Mock;
        findFirst: jest.Mock;
        findUnique: jest.Mock;
      };
    },
    lifecycle: lifecycle as unknown as {
      approve: jest.Mock;
      reject: jest.Mock;
      cancel: jest.Mock;
    },
    kyverno: kyverno as unknown as { resolveRuleNames: jest.Mock },
    clusters: clusters as unknown as { getMetadata: jest.Mock },
    gitOpsPublisher: gitOpsPublisher as unknown as {
      publishManifest: jest.Mock;
    },
  };
}

describe("ExceptionRequestsService access control", () => {
  it("hides a request whose cluster is not assigned to the approver", async () => {
    const context = harness(record({ targetClusterId: "prod" }));

    await expect(
      context.service.get("request-1", approver),
    ).rejects.toMatchObject({
      code: EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND.code,
    });
  });

  it("hides a request whose cluster is not assigned to an admin", async () => {
    const context = harness(record({ targetClusterId: "prod" }));
    const unassignedAdmin = { ...admin, clusterIds: [] };

    await expect(
      context.service.get("request-1", unassignedAdmin),
    ).rejects.toMatchObject({
      code: EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND.code,
    });
  });

  it("lets an admin reach an assigned cluster", async () => {
    const context = harness(record({ targetClusterId: "prod" }));

    await expect(
      context.service.get("request-1", { ...admin, clusterIds: ["prod"] }),
    ).resolves.toMatchObject({ id: "request-1" });
  });

  it("denies a non-admin with no cluster assignment", async () => {
    const context = harness();
    const unassigned: AuthenticatedUser = { ...approver, clusterIds: [] };

    await expect(
      context.service.get("request-1", unassigned),
    ).rejects.toMatchObject({
      code: EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND.code,
    });
  });

  it("scopes approver lists to assigned clusters", async () => {
    const context = harness();

    await context.service.list(approver);

    expect(
      context.prisma.policyExceptionRequest.findMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { targetClusterId: { in: ["local"] } },
      }),
    );
  });

  it("blocks cancelling a request outside the assigned clusters", async () => {
    const context = harness(
      record({ targetClusterId: "prod", requestUserId: requester.id }),
    );

    await expect(
      context.service.cancel("request-1", requester),
    ).rejects.toMatchObject({
      code: EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND.code,
    });
    expect(context.lifecycle.cancel).not.toHaveBeenCalled();
  });

  it("rejects creating a request for an unassigned cluster", async () => {
    const context = harness();
    context.clusters.getMetadata.mockReturnValue({
      id: "prod",
      displayName: "Production",
      exceptionNamespace: "kyverno",
    });

    await expect(
      context.service.create(
        {
          policyName: "disallow-latest-tag",
          ruleNames: ["disallow-latest-tag"],
          reason: "no access",
          resourceKind: "Deployment",
          resourceName: "api",
          resourceNamespace: "default",
          targetClusterId: "prod",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        requester,
      ),
    ).rejects.toMatchObject({
      code: KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED.code,
    });
  });

  it("limits requester lists to their own requests", async () => {
    const context = harness();
    await context.service.list(requester);
    expect(context.prisma.policyExceptionRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          requestUserId: requester.id,
          targetClusterId: { in: ["local"] },
        },
      }),
    );

    await context.service.list(admin);
    expect(
      context.prisma.policyExceptionRequest.findMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { targetClusterId: { in: ["local"] } },
      }),
    );
  });

  it("returns 404 when a requester reads or cancels another user's request", async () => {
    const context = harness(record({ requestUserId: "someone-else" }));
    await expect(
      context.service.get("request-1", requester),
    ).rejects.toMatchObject({
      code: EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND.code,
    });
    await expect(
      context.service.cancel("request-1", requester),
    ).rejects.toMatchObject({
      code: EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND.code,
    });
    expect(context.lifecycle.cancel).not.toHaveBeenCalled();
  });

  it("allows administrators to cancel any request", async () => {
    const context = harness(record({ requestUserId: "someone-else" }));
    await context.service.cancel("request-1", admin);
    expect(context.lifecycle.cancel).toHaveBeenCalledWith(
      "request-1",
      admin.id,
    );
  });

  it("hides internal failures from unprivileged readers but keeps them for approvers", async () => {
    const failed = record({
      status: ExceptionStatus.FAILED,
      lastError:
        "request to https://10.96.0.1 failed with Bearer secret-cluster-token",
    });
    const context = harness(failed);

    await expect(context.service.list(requester)).resolves.toEqual([
      expect.objectContaining({ id: failed.id, lastError: null }),
    ]);
    await expect(
      context.service.get(failed.id, requester),
    ).resolves.toMatchObject({
      id: failed.id,
      lastError: null,
    });
    await expect(context.service.list(approver)).resolves.toEqual([
      expect.objectContaining({
        id: failed.id,
        lastError: failed.lastError,
      }),
    ]);
    await expect(context.service.list(viewer)).resolves.toEqual([
      expect.objectContaining({ id: failed.id, lastError: null }),
    ]);
    await expect(
      context.service.cancel(failed.id, requester),
    ).resolves.toMatchObject({
      id: failed.id,
      lastError: null,
    });
  });

  it("blocks non-admin self approval and rejection", async () => {
    const selfApprover = { ...approver, id: requester.id };
    const context = harness();
    await expect(
      context.service.approve("request-1", {}, selfApprover),
    ).rejects.toMatchObject({
      code: EXCEPTION_REQUEST_ERROR.SELF_DECISION_FORBIDDEN.code,
    });
    await expect(
      context.service.reject("request-1", {}, selfApprover),
    ).rejects.toMatchObject({
      code: EXCEPTION_REQUEST_ERROR.SELF_DECISION_FORBIDDEN.code,
    });
  });

  it("does not transition state when Kubernetes policy lookup fails", async () => {
    const context = harness();
    context.kyverno.resolveRuleNames.mockRejectedValue(
      new Error("connection refused"),
    );

    await expect(
      context.service.approve("request-1", {}, approver),
    ).rejects.toMatchObject({
      code: EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE.code,
    });
    expect(context.lifecycle.approve).not.toHaveBeenCalled();
  });

  it("preserves a business error raised while resolving the target cluster", async () => {
    const context = harness();
    const clusterError = new BusinessException(
      KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED,
      { context: { clusterId: "missing" } },
    );
    context.kyverno.resolveRuleNames.mockRejectedValue(clusterError);

    await expect(
      context.service.approve("request-1", {}, approver),
    ).rejects.toBe(clusterError);
    expect(context.lifecycle.approve).not.toHaveBeenCalled();
  });

  it("rechecks expiration immediately before approval", async () => {
    const context = harness(record({ expiresAt: new Date(Date.now() - 1) }));
    await expect(
      context.service.approve("request-1", {}, approver),
    ).rejects.toMatchObject({
      code: EXCEPTION_REQUEST_ERROR.EXPIRED.code,
    });
    expect(context.kyverno.resolveRuleNames).not.toHaveBeenCalled();
  });

  it("triggers GitOps publishManifest when an exception request is approved", async () => {
    const context = harness();
    await context.service.approve("request-1", {}, approver);

    expect(context.lifecycle.approve).toHaveBeenCalledWith(
      "request-1",
      approver.id,
      ["rule"],
      undefined,
    );
    expect(context.gitOpsPublisher.publishManifest).toHaveBeenCalled();
  });
});
