import { execFileSync } from "node:child_process";
import { ConfigService } from "@nestjs/config";
import {
  KyvernoAdapter,
  PolicyExceptionConflictError,
  PolicyNotFoundError,
  PolicyRuleValidationError,
} from "../src/kubernetes/kyverno.adapter";
import { MultiClusterProvider } from "../src/kubernetes/multi-cluster.provider";
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  REQUEST_ID_LABEL,
} from "../src/kubernetes/policy-exception-manifest";

/**
 * 실 Kubernetes API 서버를 상대로 provider/adapter 이음매를 검증한다.
 *
 * 유닛 테스트는 `@kubernetes/client-node` 를 통째로 mock 하고, 다른 통합 스펙은
 * fake ClusterProvider 를 쓴다. 그래서 SA 토큰 인증, caData TLS, 실제 CRD 의
 * 스키마 검증과 defaulting, RBAC 격리는 어디에서도 검증되지 않는다. 이 스펙만
 * 그 구간을 덮는다.
 *
 * `RUN_CLUSTER_TESTS=1 pnpm test:integration` 으로만 실행된다.
 */

const apiServer = process.env.E2E_APISERVER;
const describeCluster = apiServer ? describe : describe.skip;

const CLUSTER_A = "e2e-a";
const CLUSTER_B = "e2e-b";
const CLUSTER_B_INTO_A = "e2e-b-into-a";
const CLUSTER_UNREACHABLE = "e2e-unreachable";

// TEST-NET-1. 라우팅되지 않으므로 TCP connect 가 그대로 매달린다.
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

describeCluster("multi-cluster provider against a real API server", () => {
  const namespaceA = process.env.E2E_NS_A as string;
  const namespaceB = process.env.E2E_NS_B as string;
  const policyName = process.env.E2E_POLICY_NAME as string;
  const policyRule = process.env.E2E_POLICY_RULE as string;
  const kubeconfig = process.env.E2E_KUBECONFIG_PATH as string;

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
    // Deployment 여야 파생 Pod 매처가 붙는다. Pod 으로 하면 매처가 하나뿐이라
    // spec.match.any 단언이 무의미해진다.
    resourceKind: "Deployment",
    resourceName: "e2e-api",
    resourceNamespace: "default",
  });

  function kubectl(args: string[]): string {
    return execFileSync("kubectl", ["--kubeconfig", kubeconfig, ...args], {
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  function readException(namespace: string, name: string): StoredException {
    return JSON.parse(
      kubectl(["-n", namespace, "get", "policyexception", name, "-o", "json"]),
    ) as StoredException;
  }

  beforeAll(() => {
    const clusters = [
      {
        id: CLUSTER_A,
        displayName: "E2E A",
        exceptionNamespace: namespaceA,
        server: apiServer,
        caData: process.env.E2E_CA_DATA,
        token: process.env.E2E_TOKEN_A,
        default: true,
      },
      {
        id: CLUSTER_B,
        displayName: "E2E B",
        exceptionNamespace: namespaceB,
        server: apiServer,
        caData: process.env.E2E_CA_DATA,
        token: process.env.E2E_TOKEN_B,
      },
      {
        // 토큰 B 로 네임스페이스 A 를 가리킨다 — RBAC 격리 확인용.
        id: CLUSTER_B_INTO_A,
        displayName: "E2E B into A",
        exceptionNamespace: namespaceA,
        server: apiServer,
        caData: process.env.E2E_CA_DATA,
        token: process.env.E2E_TOKEN_B,
      },
    ];

    clusters.push({
      id: CLUSTER_UNREACHABLE,
      displayName: "E2E Unreachable",
      exceptionNamespace: namespaceA,
      server: BLACKHOLE_SERVER,
      caData: process.env.E2E_CA_DATA,
      token: process.env.E2E_TOKEN_A,
    });

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
    requestId = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    exceptionName = `pac-exception-${requestId}`;
  });

  afterEach(() => {
    for (const namespace of [namespaceA, namespaceB]) {
      try {
        kubectl([
          "-n",
          namespace,
          "delete",
          "policyexception",
          exceptionName,
          "--ignore-not-found",
        ]);
      } catch {
        // 정리 실패가 다음 테스트를 가리지 않도록 삼킨다.
      }
    }
  });

  /**
   * 리컨실 배치는 후보를 순차로 돌기 때문에 응답 없는 클러스터 하나가 뒤의 모든
   * 작업을 붙잡는다. 타임아웃이 실제 전송 계층까지 도달하는지 확인한다.
   */
  it("gives up on an unreachable cluster within the configured timeout", async () => {
    const startedAt = Date.now();
    await expect(
      adapter.resolveRuleNames(
        CLUSTER_UNREACHABLE,
        policyName,
        [policyRule],
        "Deployment",
      ),
    ).rejects.toBeDefined();
    expect(Date.now() - startedAt).toBeLessThan(SHORT_TIMEOUT_MS * 5);
  }, 30_000);

  it("builds live connections for every configured entry", () => {
    expect(provider.list().map((cluster) => cluster.id)).toEqual([
      CLUSTER_A,
      CLUSTER_B,
      CLUSTER_B_INTO_A,
      CLUSTER_UNREACHABLE,
    ]);
    expect(provider.getDefault().id).toBe(CLUSTER_A);
    expect(provider.getMetadata(CLUSTER_B).exceptionNamespace).toBe(namespaceB);
  });

  it("reads a real ClusterPolicy using ServiceAccount token auth over TLS", async () => {
    await expect(
      adapter.resolveRuleNames(
        CLUSTER_A,
        policyName,
        [policyRule],
        "Deployment",
      ),
    ).resolves.toEqual([policyRule]);
  });

  it("maps a missing policy and an unknown rule to their domain errors", async () => {
    await expect(
      adapter.resolveRuleNames(
        CLUSTER_A,
        "no-such-policy",
        [policyRule],
        "Deployment",
      ),
    ).rejects.toBeInstanceOf(PolicyNotFoundError);

    await expect(
      adapter.resolveRuleNames(
        CLUSTER_A,
        policyName,
        ["no-such-rule"],
        "Deployment",
      ),
    ).rejects.toBeInstanceOf(PolicyRuleValidationError);
  });

  it("creates a PolicyException the real CRD schema accepts", async () => {
    await adapter.ensurePolicyException(CLUSTER_A, manifestInput());

    const stored = readException(namespaceA, exceptionName);
    expect(stored.metadata.labels[MANAGED_BY_LABEL]).toBe(MANAGED_BY_VALUE);
    expect(stored.metadata.labels[REQUEST_ID_LABEL]).toBe(requestId);
    expect(stored.spec.exceptions).toEqual([
      { policyName, ruleNames: [policyRule] },
    ]);
    expect(stored.spec.match.any).toEqual([
      {
        resources: {
          kinds: ["Deployment"],
          names: ["e2e-api"],
          namespaces: ["default"],
        },
      },
      {
        resources: {
          kinds: ["Pod"],
          names: ["e2e-api-*"],
          namespaces: ["default"],
        },
      },
    ]);
  });

  /**
   * 어댑터는 기존 CR 의 spec 을 정규화 문자열로 비교한다. 서버가 defaulting 으로
   * spec 에 필드를 하나라도 추가하면 매 리컨실마다 Conflict 가 나고 APPROVED 요청이
   * 백오프로 무한 재시도한다. fake provider 로는 절대 드러나지 않는 실패다.
   */
  it("stays idempotent against server-side defaulting", async () => {
    await adapter.ensurePolicyException(CLUSTER_A, manifestInput());
    await expect(
      adapter.ensurePolicyException(CLUSTER_A, manifestInput()),
    ).resolves.toBeUndefined();
  });

  it("recreates a PolicyException deleted out of band", async () => {
    await adapter.ensurePolicyException(CLUSTER_A, manifestInput());
    kubectl(["-n", namespaceA, "delete", "policyexception", exceptionName]);
    await expect(
      adapter.getPolicyException(CLUSTER_A, exceptionName),
    ).resolves.toBeNull();

    await adapter.ensurePolicyException(CLUSTER_A, manifestInput());
    expect(readException(namespaceA, exceptionName).metadata.name).toBe(
      exceptionName,
    );
  });

  /**
   * 어댑터는 update/patch 를 하지 않는다. 외부에서 spec 이 변조된 CR 은 복구되지
   * 않고 Conflict 로 남는 것이 현재 설계다 — 그 계약을 못박는다.
   */
  it("reports a conflict for an out-of-band spec mutation", async () => {
    await adapter.ensurePolicyException(CLUSTER_A, manifestInput());
    kubectl([
      "-n",
      namespaceA,
      "patch",
      "policyexception",
      exceptionName,
      "--type=json",
      "-p",
      '[{"op":"replace","path":"/spec/exceptions/0/ruleNames","value":["require-image-tag"]}]',
    ]);

    await expect(
      adapter.ensurePolicyException(CLUSTER_A, manifestInput()),
    ).rejects.toBeInstanceOf(PolicyExceptionConflictError);
  });

  it("routes each entry to its own namespace", async () => {
    await adapter.ensurePolicyException(CLUSTER_B, manifestInput());

    expect(readException(namespaceB, exceptionName).metadata.namespace).toBe(
      namespaceB,
    );
    await expect(
      adapter.getPolicyException(CLUSTER_A, exceptionName),
    ).resolves.toBeNull();
  });

  /**
   * 같은 서버라도 엔트리마다 다른 토큰이 실제로 적용되는지. 403 은 404 로 삼켜지지
   * 않고 위로 전파되어야 한다.
   */
  it("keeps credentials isolated per entry", async () => {
    // ApiException 은 HTTP 상태를 `code` 로 싣는다.
    await expect(
      adapter.getPolicyException(CLUSTER_B_INTO_A, exceptionName),
    ).rejects.toMatchObject({ code: 403 });
  });

  it("deletes a PolicyException and tolerates a repeated delete", async () => {
    await adapter.ensurePolicyException(CLUSTER_A, manifestInput());
    await adapter.deletePolicyException(CLUSTER_A, exceptionName);

    await expect(
      adapter.getPolicyException(CLUSTER_A, exceptionName),
    ).resolves.toBeNull();
    await expect(
      adapter.deletePolicyException(CLUSTER_A, exceptionName),
    ).resolves.toBeUndefined();
  });
});

/**
 * 아래는 우리 코드가 아니라 Kyverno 에 관한 사실을 단언하는 외부 계약 카나리다.
 * 어댑터가 `v2beta1` 을 하드코딩하므로, KYVERNO_CRD_VERSION 을 올렸을 때 그 버전이
 * 더 이상 served 가 아니면 여기서 먼저 큰 소리로 깨져야 한다.
 */
describeCluster("Kyverno CRD contract", () => {
  // KyvernoAdapter 의 EXCEPTION_VERSION 은 export 되지 않아 값을 그대로 적는다.
  // 어댑터 쪽 상수를 바꾸면 여기도 함께 바꿔야 한다.
  const ADAPTER_EXCEPTION_VERSION = "v2";

  it("still serves the apiVersion the adapter writes", () => {
    const served = execFileSync(
      "kubectl",
      [
        "--kubeconfig",
        process.env.E2E_KUBECONFIG_PATH as string,
        "get",
        "crd",
        "policyexceptions.kyverno.io",
        "-o",
        "jsonpath={.spec.versions[?(@.served==true)].name}",
      ],
      { encoding: "utf8", stdio: "pipe" },
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    expect(served).toContain(ADAPTER_EXCEPTION_VERSION);
  });
});
