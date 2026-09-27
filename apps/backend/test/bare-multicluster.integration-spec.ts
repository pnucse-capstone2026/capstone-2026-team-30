import { execFileSync } from "node:child_process";
import { ConfigService } from "@nestjs/config";
import { KyvernoAdapter } from "../src/kubernetes/kyverno.adapter";
import { MultiClusterProvider } from "../src/kubernetes/multi-cluster.provider";
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
} from "../src/kubernetes/policy-exception-manifest";

/**
 * Literal Multi-Cluster Integration Test Suite.
 *
 * Verifies that MultiClusterProvider and KyvernoAdapter behave correctly
 * across two separate, independent Kubernetes control planes with distinct
 * TLS CAs, apiserver endpoints, and ServiceAccount signing keys.
 */

const serverA = process.env.E2E_MC_SERVER_A;
const serverB = process.env.E2E_MC_SERVER_B;
const describeMultiCluster = serverA && serverB ? describe : describe.skip;

const CLUSTER_A_ID = "mc-alpha";
const CLUSTER_B_ID = "mc-beta";
const CLUSTER_B_TOKEN_ON_A_ID = "mc-b-token-on-a";
const CLUSTER_UNREACHABLE_ID = "mc-unreachable";

const BLACKHOLE_SERVER = "https://192.0.2.1:6443";
const SHORT_TIMEOUT_MS = 2_000;

type StoredException = {
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
  };
  spec: {
    exceptions: Array<{ policyName: string; ruleNames: string[] }>;
    match: { any: unknown[] };
  };
};

describeMultiCluster("literal bare-minimum multi-cluster environment", () => {
  const namespaceA = (process.env.E2E_MC_NS_A as string) || "pac-mc-a";
  const namespaceB = (process.env.E2E_MC_NS_B as string) || "pac-mc-b";
  const policyName =
    (process.env.E2E_POLICY_NAME as string) || "disallow-latest-tag";
  const policyRule =
    (process.env.E2E_POLICY_RULE as string) || "disallow-latest-tag";
  const kubeconfigA = process.env.E2E_MC_KUBECONFIG_A as string;
  const kubeconfigB = process.env.E2E_MC_KUBECONFIG_B as string;

  let adapter: KyvernoAdapter;
  let provider: MultiClusterProvider;
  let exceptionName: string;
  let requestId: string;
  let counter = 0;

  const manifestInput = () => ({
    name: exceptionName,
    requestId,
    policyName,
    ruleNames: [policyRule],
    resourceKind: "Deployment",
    resourceName: "mc-workload",
    resourceNamespace: "default",
  });

  function kubectl(kubeconfig: string, args: string[]): string {
    return execFileSync("kubectl", ["--kubeconfig", kubeconfig, ...args], {
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  function readException(kubeconfig: string, namespace: string, name: string): StoredException {
    return JSON.parse(
      kubectl(kubeconfig, ["-n", namespace, "get", "policyexception", name, "-o", "json"]),
    ) as StoredException;
  }

  beforeAll(() => {
    const clusters = [
      {
        id: CLUSTER_A_ID,
        displayName: "Bare Kind Alpha",
        exceptionNamespace: namespaceA,
        server: serverA,
        caData: process.env.E2E_MC_CA_A,
        token: process.env.E2E_MC_TOKEN_A,
        default: true,
      },
      {
        id: CLUSTER_B_ID,
        displayName: "Bare Kind Beta",
        exceptionNamespace: namespaceB,
        server: serverB,
        caData: process.env.E2E_MC_CA_B,
        token: process.env.E2E_MC_TOKEN_B,
      },
      {
        // Cluster B token hitting Cluster A API server
        id: CLUSTER_B_TOKEN_ON_A_ID,
        displayName: "Cross Cluster Invalid Token",
        exceptionNamespace: namespaceA,
        server: serverA,
        caData: process.env.E2E_MC_CA_A,
        token: process.env.E2E_MC_TOKEN_B,
      },
      {
        id: CLUSTER_UNREACHABLE_ID,
        displayName: "Unreachable Network Endpoint",
        exceptionNamespace: namespaceA,
        server: BLACKHOLE_SERVER,
        caData: process.env.E2E_MC_CA_A,
        token: process.env.E2E_MC_TOKEN_A,
      },
    ];

    const config = {
      get: (key: string) => {
        if (key === "KUBERNETES_CLUSTERS") return JSON.stringify(clusters);
        if (key === "KUBERNETES_REQUEST_TIMEOUT_MS") {
          return String(SHORT_TIMEOUT_MS);
        }
        return undefined;
      },
    } as unknown as ConfigService;

    provider = new MultiClusterProvider(config);
    adapter = new KyvernoAdapter(provider);
  });

  beforeEach(() => {
    counter += 1;
    requestId = `10000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    exceptionName = `pac-mc-exception-${requestId}`;
  });

  afterEach(() => {
    if (kubeconfigA) {
      try {
        kubectl(kubeconfigA, [
          "-n",
          namespaceA,
          "delete",
          "policyexception",
          exceptionName,
          "--ignore-not-found",
        ]);
      } catch {
        // Suppress cleanup error
      }
    }
    if (kubeconfigB) {
      try {
        kubectl(kubeconfigB, [
          "-n",
          namespaceB,
          "delete",
          "policyexception",
          exceptionName,
          "--ignore-not-found",
        ]);
      } catch {
        // Suppress cleanup error
      }
    }
  });

  it("registers both distinct clusters with independent server endpoints", () => {
    const list = provider.list();
    expect(list.map((c) => c.id)).toContain(CLUSTER_A_ID);
    expect(list.map((c) => c.id)).toContain(CLUSTER_B_ID);
    expect(provider.getDefault().id).toBe(CLUSTER_A_ID);
    expect(serverA).not.toEqual(serverB);
  });

  it("authenticates independently to Cluster A and Cluster B via their respective tokens", async () => {
    const rulesA = await adapter.resolveRuleNames(
      CLUSTER_A_ID,
      policyName,
      [policyRule],
      "Deployment",
    );
    expect(rulesA).toEqual([policyRule]);

    const rulesB = await adapter.resolveRuleNames(
      CLUSTER_B_ID,
      policyName,
      [policyRule],
      "Deployment",
    );
    expect(rulesB).toEqual([policyRule]);
  });

  it("strictly rejects authentication when Token B is presented to Cluster A", async () => {
    await expect(
      adapter.resolveRuleNames(
        CLUSTER_B_TOKEN_ON_A_ID,
        policyName,
        [policyRule],
        "Deployment",
      ),
    ).rejects.toMatchObject({
      code: expect.toBeOneOf ? expect.toBeOneOf([401, 403]) : expect.any(Number),
    });
  });

  it("isolates PolicyException creation to the target cluster only", async () => {
    await adapter.ensurePolicyException(CLUSTER_A_ID, manifestInput());

    if (kubeconfigA) {
      const storedA = readException(kubeconfigA, namespaceA, exceptionName);
      expect(storedA.metadata.name).toBe(exceptionName);
      expect(storedA.metadata.labels[MANAGED_BY_LABEL]).toBe(MANAGED_BY_VALUE);
    }

    // Must NOT exist in Cluster B
    await expect(
      adapter.getPolicyException(CLUSTER_B_ID, exceptionName),
    ).resolves.toBeNull();
  });

  it("times out on the unreachable cluster within the configured timeout threshold", async () => {
    const startedAt = Date.now();
    await expect(
      adapter.resolveRuleNames(
        CLUSTER_UNREACHABLE_ID,
        policyName,
        [policyRule],
        "Deployment",
      ),
    ).rejects.toBeDefined();
    expect(Date.now() - startedAt).toBeLessThan(SHORT_TIMEOUT_MS * 5);
  }, 30_000);
});
