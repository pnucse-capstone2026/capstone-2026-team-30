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

  describe("Informer Cache Integration", () => {
    it("returns cached cluster policies and policy reports when informer is warm without calling K8s API", async () => {
      const mockInformerService = {
        listClusterPolicies: jest
          .fn()
          .mockReturnValue([{ metadata: { name: "cached-policy" } }]),
        listClusterPolicyReports: jest
          .fn()
          .mockReturnValue([{ metadata: { name: "cached-cpr" } }]),
        listNamespacedPolicyReports: jest
          .fn()
          .mockReturnValue([{ metadata: { name: "cached-pr" } }]),
        listPolicyExceptions: jest
          .fn()
          .mockReturnValue([{ metadata: { name: "cached-polex" } }]),
        getClusterPolicy: jest
          .fn()
          .mockReturnValue({ metadata: { name: "cached-policy" } }),
        getPolicyException: jest
          .fn()
          .mockReturnValue({ metadata: { name: "cached-polex" } }),
      };

      const cachedAdapter = new KyvernoAdapter(
        clusters,
        mockInformerService as any,
      );

      const policies = await cachedAdapter.listClusterPolicies("local");
      const cprs = await cachedAdapter.listClusterPolicyReports("local");
      const prs = await cachedAdapter.listNamespacedPolicyReports(
        "local",
        "default",
      );
      const polexs = await cachedAdapter.listPolicyExceptions("local");
      const singlePolicy = await cachedAdapter.getClusterPolicy(
        "local",
        "cached-policy",
      );
      const singlePolex = await cachedAdapter.getPolicyException(
        "local",
        "cached-polex",
      );

      expect(policies).toHaveLength(1);
      expect(cprs).toHaveLength(1);
      expect(prs).toHaveLength(1);
      expect(polexs).toHaveLength(1);
      expect(singlePolicy).toEqual({ metadata: { name: "cached-policy" } });
      expect(singlePolex).toEqual({ metadata: { name: "cached-polex" } });

      // K8s API must NOT be called since informer cache fulfilled all queries
      expect(api.getClusterCustomObject).not.toHaveBeenCalled();
      expect(api.getNamespacedCustomObject).not.toHaveBeenCalled();
    });

    it("falls back to K8s API when informer returns null (cold / not ready)", async () => {
      const mockInformerService = {
        listClusterPolicies: jest.fn().mockReturnValue(null),
        listClusterPolicyReports: jest.fn().mockReturnValue(null),
        listNamespacedPolicyReports: jest.fn().mockReturnValue(null),
        listPolicyExceptions: jest.fn().mockReturnValue(null),
        getClusterPolicy: jest.fn().mockReturnValue(undefined),
        getPolicyException: jest.fn().mockReturnValue(undefined),
      };

      api.getClusterCustomObject.mockResolvedValueOnce({
        metadata: { name: "live-policy" },
      });
      (clusters.get("local").customObjectsApi as any).listClusterCustomObject =
        jest
          .fn()
          .mockResolvedValueOnce({
            items: [{ metadata: { name: "live-policy" } }],
          });

      const fallbackAdapter = new KyvernoAdapter(
        clusters,
        mockInformerService as any,
      );

      const policies = await fallbackAdapter.listClusterPolicies("local");
      expect(policies).toHaveLength(1);
      expect(mockInformerService.listClusterPolicies).toHaveBeenCalledWith(
        "local",
      );
    });
  });
});
