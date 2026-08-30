import { Test, TestingModule } from "@nestjs/testing";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { PrismaService } from "../prisma/prisma.service";
import { ViolationSeverityFilter } from "./dto/list-violations-query.dto";
import { VIOLATION_ERROR } from "./violation.errors";
import { ViolationsService } from "./violations.service";

describe("ViolationsService", () => {
  let service: ViolationsService;
  let mockClusterProvider: Partial<ClusterProvider>;
  let mockKyvernoAdapter: Partial<KyvernoAdapter>;
  let mockPrismaService: {
    violationHistory: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "user@example.com",
    role: Role.APPROVER,
    clusterIds: ["cluster-1", "cluster-2"],
  };

  const mockPolicyReportRaw = {
    metadata: {
      name: "polr-ns-payments",
      namespace: "payments",
      creationTimestamp: "2026-08-19T05:30:00Z",
    },
    results: [
      {
        policy: "disallow-latest-tag",
        rule: "require-image-tag",
        severity: "high",
        result: "fail",
        message: "Using the :latest tag is prohibited.",
        resources: [
          {
            apiVersion: "v1",
            kind: "Pod",
            name: "payment-api-pod",
            namespace: "payments",
          },
        ],
        timestamp: { seconds: 1724050000 },
      },
      {
        policy: "require-team-label",
        rule: "check-team-label",
        severity: "medium",
        result: "pass",
        message: "Team label exists.",
        resources: [
          {
            apiVersion: "v1",
            kind: "Pod",
            name: "payment-api-pod",
            namespace: "payments",
          },
        ],
      },
    ],
  };

  const mockClusterPolicyReportRaw = {
    metadata: {
      name: "cpolr-cluster",
      creationTimestamp: "2026-08-19T05:30:00Z",
    },
    results: [
      {
        policy: "require-ro-rootfs",
        rule: "check-read-only-root-filesystem",
        severity: "critical",
        result: "fail",
        message: "rootFS must be read-only",
        resources: [
          {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name: "batch-worker",
            namespace: "batch",
          },
        ],
      },
    ],
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
      listClusterPolicyReports: jest
        .fn()
        .mockResolvedValue([mockClusterPolicyReportRaw]),
      listNamespacedPolicyReports: jest
        .fn()
        .mockResolvedValue([mockPolicyReportRaw]),
      getClusterPolicyReport: jest
        .fn()
        .mockResolvedValue(mockClusterPolicyReportRaw),
      getNamespacedPolicyReport: jest
        .fn()
        .mockResolvedValue(mockPolicyReportRaw),
      getClusterPolicyReports: jest.fn().mockResolvedValue([]),
      getPolicyReports: jest.fn().mockResolvedValue([]),
    };

    mockPrismaService = {
      violationHistory: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "db-vio-1" }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViolationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ClusterProvider, useValue: mockClusterProvider },
        { provide: KyvernoAdapter, useValue: mockKyvernoAdapter },
      ],
    }).compile();

    service = module.get<ViolationsService>(ViolationsService);
  });

  describe("list", () => {
    it("fail 상태의 위반 항목들만 정상 추출하여 반환한다", async () => {
      const result = await service.list(mockUser, {});

      // 2 clusters * (1 cpolr failure + 1 polr failure) = 4 violations
      expect(result).toHaveLength(4);
      expect(result.some((v) => v.policyName === "disallow-latest-tag")).toBe(
        true,
      );
      expect(result.some((v) => v.policyName === "require-ro-rootfs")).toBe(
        true,
      );
      // pass 상태는 제외되어야 함
      expect(result.some((v) => v.policyName === "require-team-label")).toBe(
        false,
      );
    });

    it("특정 클러스터 및 심각도로 필터링하여 위반 목록을 반환한다", async () => {
      const result = await service.list(mockUser, {
        clusterId: "cluster-1",
        severity: ViolationSeverityFilter.CRITICAL,
      });

      expect(result).toHaveLength(1);
      expect(result[0].policyName).toBe("require-ro-rootfs");
      expect(result[0].severity).toBe("critical");
    });

    it("검색어로 필터링하여 위반 목록을 반환한다", async () => {
      const result = await service.list(mockUser, { search: "payment-api" });

      expect(result).toHaveLength(2);
      expect(result.every((v) => v.resourceName === "payment-api-pod")).toBe(
        true,
      );
    });

    it("접근 권한이 없는 클러스터 지정 시 빈 목록을 반환한다", async () => {
      const result = await service.list(mockUser, { clusterId: "cluster-3" });
      expect(result).toHaveLength(0);
    });
  });

  describe("getDetail", () => {
    it("PolicyReport 단건 위반 상세와 추천 해결 가이드를 정상 반환한다", async () => {
      const detail = await service.getDetail(
        "cluster-1",
        "cluster-1:polr-ns-payments:0",
        mockUser,
      );

      expect(detail).toBeDefined();
      expect(detail.policyName).toBe("disallow-latest-tag");
      expect(detail.severity).toBe("high");
      expect(detail.recommendation).toContain(
        "':latest' 태그 사용을 제거하세요",
      );
      expect(detail.resourceSpec).toBeDefined();
    });

    it("잘못된 ID 포맷인 경우 BusinessException(NOT_FOUND)을 던진다", async () => {
      await expect(
        service.getDetail("cluster-1", "invalid-format", mockUser),
      ).rejects.toThrow(BusinessException);
    });

    it("접근 권한이 없는 클러스터 위반 조회 시 BusinessException(CLUSTER_ACCESS_DENIED)을 던진다", async () => {
      await expect(
        service.getDetail(
          "cluster-3",
          "cluster-3:polr-ns-payments:0",
          mockUser,
        ),
      ).rejects.toThrow(
        new BusinessException(VIOLATION_ERROR.CLUSTER_ACCESS_DENIED),
      );
    });

    it("DB Fallback 기록인 UUID 형태의 ID 조회를 정상 처리한다", async () => {
      mockPrismaService.violationHistory.findUnique.mockResolvedValueOnce({
        id: "ec90b8e7-2112-4ea0-a55b-b65100acffc5",
        policyName: "disallow-latest-tag",
        ruleName: "require-image-tag",
        targetClusterId: "cluster-1",
        targetClusterDisplayName: "Cluster One",
        occurredAt: new Date("2026-08-19T05:30:00Z"),
      });

      const detail = await service.getDetail(
        "cluster-1",
        "ec90b8e7-2112-4ea0-a55b-b65100acffc5",
        mockUser,
      );

      expect(detail).toBeDefined();
      expect(detail.id).toBe("ec90b8e7-2112-4ea0-a55b-b65100acffc5");
      expect(detail.policyName).toBe("disallow-latest-tag");
      expect(detail.reportName).toBe("db-fallback");
    });

    it("존재하지 않는 결과 인덱스 조회 시 BusinessException(NOT_FOUND)을 던진다", async () => {
      await expect(
        service.getDetail(
          "cluster-1",
          "cluster-1:polr-ns-payments:99",
          mockUser,
        ),
      ).rejects.toThrow(new BusinessException(VIOLATION_ERROR.NOT_FOUND));
    });
  });

  describe("getViolations DB Fallback", () => {
    it("K8s API 호출 시 장애 발생 시 DB ViolationHistory 조회를 fallback으로 실행한다", async () => {
      (
        mockKyvernoAdapter.listClusterPolicyReports as jest.Mock
      ).mockRejectedValue(new Error("K8s cluster unreachable"));
      (
        mockKyvernoAdapter.listNamespacedPolicyReports as jest.Mock
      ).mockRejectedValue(new Error("K8s cluster unreachable"));

      mockPrismaService.violationHistory.findMany.mockResolvedValueOnce([
        {
          id: "db-vio-001",
          policyName: "disallow-latest-tag",
          ruleName: "require-image-tag",
          targetClusterId: "cluster-1",
          targetClusterDisplayName: "Cluster One",
          occurredAt: new Date("2026-08-19T05:30:00Z"),
        },
      ]);

      const result = await service.getViolations(mockUser, {});

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("db-vio-001");
      expect(result[0].policyName).toBe("disallow-latest-tag");
      expect(result[0].reportName).toBe("db-fallback");
    });
  });

  describe("syncLiveViolations", () => {
    it("K8s의 live 위반 보고서를 수집하여 DB ViolationHistory에 새로 생성한다", async () => {
      (
        mockKyvernoAdapter.getClusterPolicyReports as jest.Mock
      ).mockResolvedValueOnce([
        {
          id: "cluster-1:cpolr-cluster:0",
          clusterId: "cluster-1",
          clusterDisplayName: "Cluster One",
          namespace: "cluster-wide",
          policyName: "require-ro-rootfs",
          ruleName: "check-read-only-root-filesystem",
          resourceKind: "Deployment",
          resourceName: "batch-worker",
          severity: "critical",
          status: "open",
          message: "rootFS must be read-only",
          detectedAt: "2026-08-19T05:30:00.000Z",
          reportName: "cpolr-cluster",
        },
      ]);
      (mockKyvernoAdapter.getPolicyReports as jest.Mock).mockResolvedValueOnce(
        [],
      );

      mockPrismaService.violationHistory.findFirst.mockResolvedValueOnce(null);

      await service.syncLiveViolations();

      expect(mockPrismaService.violationHistory.create).toHaveBeenCalledWith({
        data: {
          targetClusterId: "cluster-1",
          targetClusterDisplayName: "Cluster One",
          policyName: "require-ro-rootfs",
          ruleName: "check-read-only-root-filesystem",
          occurredAt: new Date("2026-08-19T05:30:00.000Z"),
        },
      });
    });
  });
});
