import { ApiException, CustomObjectsApi } from "@kubernetes/client-node";
import { ClusterProvider } from "./cluster-provider";
import {
  KyvernoAdapter,
  PolicyExceptionConflictError,
  PolicyNotFoundError,
  PolicyRuleValidationError,
} from "./kyverno.adapter";

describe("KyvernoAdapter", () => {
  const api = {
    getClusterCustomObject: jest.fn(),
    getNamespacedCustomObject: jest.fn(),
    createNamespacedCustomObject: jest.fn(),
    deleteNamespacedCustomObject: jest.fn(),
  };
  const clusters = {
    get: jest.fn(() => ({
      id: "local",
      displayName: "Local",
      exceptionNamespace: "kyverno",
      customObjectsApi: api as unknown as CustomObjectsApi,
    })),
  } as unknown as ClusterProvider;
  let adapter: KyvernoAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new KyvernoAdapter(clusters);
  });

  it("normalizes rules and adds an existing Deployment autogen rule", async () => {
    api.getClusterCustomObject.mockResolvedValue({
      spec: { rules: [{ name: "require-team" }] },
      status: { autogen: { rules: [{ name: "autogen-require-team" }] } },
    });

    await expect(
      adapter.resolveRuleNames(
        "local",
        "require-labels",
        [" require-team ", "require-team"],
        "Deployment",
      ),
    ).resolves.toEqual(["require-team", "autogen-require-team"]);
  });

  it("rejects wildcard, missing policy, and unknown rules", async () => {
    await expect(
      adapter.resolveRuleNames("local", "policy", ["*"], "Pod"),
    ).rejects.toBeInstanceOf(PolicyRuleValidationError);

    api.getClusterCustomObject.mockRejectedValueOnce(
      new ApiException(404, "Not Found", { kind: "Status" }, {}),
    );
    await expect(
      adapter.resolveRuleNames("local", "missing", ["rule"], "Pod"),
    ).rejects.toBeInstanceOf(PolicyNotFoundError);

    api.getClusterCustomObject.mockResolvedValueOnce({
      spec: { rules: [{ name: "other" }] },
    });
    await expect(
      adapter.resolveRuleNames("local", "policy", ["rule"], "Pod"),
    ).rejects.toBeInstanceOf(PolicyRuleValidationError);
  });

  it("creates once and accepts the same request and spec idempotently", async () => {
    const input = {
      name: "exception-request-1",
      requestId: "request-1",
      policyName: "policy",
      ruleNames: ["rule"],
      resourceKind: "Pod",
      resourceName: "api",
      resourceNamespace: "default",
    };
    api.getNamespacedCustomObject
      .mockRejectedValueOnce(
        new ApiException(404, "Not Found", { kind: "Status" }, {}),
      )
      .mockResolvedValueOnce({
        metadata: {
          labels: {
            "app.kubernetes.io/managed-by": "pac-kyverno-dashboard",
            "pac.kyverno.io/request-id": "request-1",
          },
        },
        spec: {
          exceptions: [{ policyName: "policy", ruleNames: ["rule"] }],
          match: {
            any: [
              {
                resources: {
                  kinds: ["Pod"],
                  names: ["api"],
                  namespaces: ["default"],
                },
              },
            ],
          },
        },
      });

    await adapter.ensurePolicyException("local", input);
    await adapter.ensurePolicyException("local", input);

    expect(api.createNamespacedCustomObject).toHaveBeenCalledTimes(1);
  });

  it("rejects an existing object owned by another request", async () => {
    api.getNamespacedCustomObject.mockResolvedValue({
      metadata: {
        labels: {
          "app.kubernetes.io/managed-by": "pac-kyverno-dashboard",
          "pac.kyverno.io/request-id": "other-request",
        },
      },
      spec: {},
    });

    await expect(
      adapter.ensurePolicyException("local", {
        name: "exception-request-1",
        requestId: "request-1",
        policyName: "policy",
        ruleNames: ["rule"],
        resourceKind: "Pod",
        resourceName: "api",
        resourceNamespace: "default",
      }),
    ).rejects.toBeInstanceOf(PolicyExceptionConflictError);
  });

  // 손으로 만든 `{ statusCode: 404 }` 는 0.22 의 모양이라 1.4 로 옮겨온 코드를
  // 검증하지 못한다. 라이브러리의 진짜 예외 클래스로 확인한다.
  it("treats a real ApiException 404 as a missing PolicyException", async () => {
    api.getNamespacedCustomObject.mockRejectedValue(
      new ApiException(404, "Not Found", { kind: "Status" }, {}),
    );

    await expect(
      adapter.getPolicyException("local", "missing"),
    ).resolves.toBeNull();
  });

  it("does not swallow a non-404 ApiException", async () => {
    const forbidden = new ApiException(
      403,
      "Forbidden",
      { kind: "Status" },
      {},
    );
    api.getNamespacedCustomObject.mockRejectedValue(forbidden);

    await expect(adapter.getPolicyException("local", "blocked")).rejects.toBe(
      forbidden,
    );
  });

  it("treats delete 404 as success", async () => {
    api.deleteNamespacedCustomObject.mockRejectedValue(
      new ApiException(404, "Not Found", { kind: "Status" }, {}),
    );
    await expect(
      adapter.deletePolicyException("local", "missing"),
    ).resolves.toBeUndefined();
  });

  it("동일 이름의 PolicyReport가 다른 네임스페이스에 있어도 고유한 위반 ID를 생성한다", async () => {
    const makeReport = (namespace: string) => ({
      metadata: {
        name: "controlled-load",
        namespace,
        creationTimestamp: "2026-08-19T05:30:00Z",
      },
      results: [
        {
          policy: "disallow-latest-tag",
          rule: "require-image-tag",
          severity: "high",
          result: "fail",
          message: "Using the :latest tag is prohibited.",
          resources: [{ kind: "Pod", name: "load-pod", namespace }],
        },
      ],
    });

    const reportApi = {
      listClusterCustomObject: jest.fn().mockResolvedValue({
        items: [
          makeReport("pac-final-bench-0905"),
          makeReport("pac-report-bench-0905"),
        ],
      }),
    };
    const reportClusters = {
      list: jest
        .fn()
        .mockReturnValue([{ id: "cluster-1", displayName: "Cluster One" }]),
      get: jest.fn(() => ({
        id: "cluster-1",
        displayName: "Cluster One",
        exceptionNamespace: "kyverno",
        customObjectsApi: reportApi as unknown as CustomObjectsApi,
      })),
    } as unknown as ClusterProvider;

    const reportAdapter = new KyvernoAdapter(reportClusters);
    const violations = await reportAdapter.getPolicyReports();

    expect(violations).toHaveLength(2);
    const ids = violations.map((v) => v.id);
    // 네임스페이스가 포함되어 동일 이름 보고서 간 ID 충돌이 발생하지 않는다.
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("cluster-1:pac-final-bench-0905/controlled-load:0");
    expect(ids).toContain("cluster-1:pac-report-bench-0905/controlled-load:0");
  });
});
