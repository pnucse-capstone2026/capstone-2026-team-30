import { Test, TestingModule } from "@nestjs/testing";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { PolicyModeFilter } from "./dto/list-policies-query.dto";
import { PoliciesService } from "./policies.service";
import { POLICY_ERROR } from "./policy.errors";

describe("PoliciesService", () => {
  let service: PoliciesService;
  let mockClusterProvider: Partial<ClusterProvider>;
  let mockKyvernoAdapter: Partial<KyvernoAdapter>;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "user@example.com",
    role: Role.VIEWER,
    clusterIds: ["cluster-1", "cluster-2"],
  };

  const mockClusterPolicyRaw = {
    metadata: {
      name: "disallow-latest-tag",
      creationTimestamp: "2026-08-19T00:00:00Z",
      annotations: {
        "policies.kyverno.io/description": "Disallow using the latest tag",
      },
    },
    spec: {
      validationFailureAction: "Enforce",
      rules: [
        {
          name: "require-image-tag",
          validate: { message: "latest tag is forbidden" },
        },
      ],
    },
    status: {
      ready: true,
      autogen: {
        rules: [{ name: "autogen-require-image-tag" }],
      },
    },
  };

  const mockNamespacedPolicyRaw = {
    metadata: {
      name: "require-team-label",
      namespace: "payments",
      creationTimestamp: "2026-08-19T00:00:00Z",
    },
    spec: {
      validationFailureAction: "Audit",
      rules: [
        {
          name: "check-team-label",
          validate: {},
        },
      ],
    },
    status: {
      ready: true,
    },
  };

  beforeEach(async () => {
    mockClusterProvider = {
      list: jest.fn().mockReturnValue([
        { id: "cluster-1", displayName: "Cluster One", default: true },
        { id: "cluster-2", displayName: "Cluster Two", default: false },
        { id: "cluster-3", displayName: "Cluster Three", default: false },
      ]),
    };

    mockKyvernoAdapter = {
      listClusterPolicies: jest.fn().mockResolvedValue([mockClusterPolicyRaw]),
      listNamespacedPolicies: jest
        .fn()
        .mockResolvedValue([mockNamespacedPolicyRaw]),
      getClusterPolicy: jest.fn().mockResolvedValue(mockClusterPolicyRaw),
      getNamespacedPolicy: jest.fn().mockResolvedValue(mockNamespacedPolicyRaw),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PoliciesService,
        { provide: ClusterProvider, useValue: mockClusterProvider },
        { provide: KyvernoAdapter, useValue: mockKyvernoAdapter },
      ],
    }).compile();

    service = module.get<PoliciesService>(PoliciesService);
  });

  describe("list", () => {
    it("사용자가 접근 가능한 클러스터의 정책 목록을 정상 집계하여 반환한다", async () => {
      const result = await service.list(mockUser, {});

      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({
        name: "disallow-latest-tag",
        mode: "enforce",
        type: "validate",
        scope: "ClusterPolicy",
        ruleCount: 1,
      });
    });

    it("특정 클러스터로 필터링하여 정책 목록을 조회한다", async () => {
      const result = await service.list(mockUser, { clusterId: "cluster-1" });

      expect(result).toHaveLength(2);
      expect(result.every((p) => p.clusterId === "cluster-1")).toBe(true);
    });

    it("검색어 및 모드로 필터링하여 정책 목록을 조회한다", async () => {
      const result = await service.list(mockUser, {
        search: "latest",
        mode: PolicyModeFilter.ENFORCE,
      });

      expect(result).toHaveLength(2);
      expect(result.every((p) => p.mode === "enforce")).toBe(true);
    });

    it("사용자에게 배정되지 않은 클러스터만 조회 요청 시 빈 목록을 반환한다", async () => {
      const result = await service.list(mockUser, { clusterId: "cluster-3" });

      expect(result).toHaveLength(0);
    });
  });

  describe("getDetail", () => {
    it("ClusterPolicy 상세 정보를 정상 반환한다", async () => {
      const detail = await service.getDetail(
        "cluster-1",
        "disallow-latest-tag",
        mockUser,
      );

      expect(detail).toBeDefined();
      expect(detail.name).toBe("disallow-latest-tag");
      expect(detail.scope).toBe("ClusterPolicy");
      expect(detail.autogenRules).toContain("autogen-require-image-tag");
      expect(detail.spec).toBeDefined();
    });

    it("Namespaced Policy 상세 정보를 정상 반환한다", async () => {
      const detail = await service.getDetail(
        "cluster-1",
        "require-team-label",
        mockUser,
        "payments",
      );

      expect(detail).toBeDefined();
      expect(detail.name).toBe("require-team-label");
      expect(detail.scope).toBe("Policy");
      expect(detail.namespace).toBe("payments");
    });

    it("인가되지 않은 클러스터 조회 시 BusinessException을 던진다", async () => {
      await expect(
        service.getDetail("cluster-3", "disallow-latest-tag", mockUser),
      ).rejects.toThrow(BusinessException);
    });

    it("존재하지 않는 정책 조회 시 BusinessException(POLICY_NOT_FOUND)을 던진다", async () => {
      (mockKyvernoAdapter.getClusterPolicy as jest.Mock).mockResolvedValue(
        null,
      );
      (
        mockKyvernoAdapter.listNamespacedPolicies as jest.Mock
      ).mockResolvedValue([]);

      await expect(
        service.getDetail("cluster-1", "non-existent-policy", mockUser),
      ).rejects.toThrow(new BusinessException(POLICY_ERROR.NOT_FOUND));
    });
  });
});
