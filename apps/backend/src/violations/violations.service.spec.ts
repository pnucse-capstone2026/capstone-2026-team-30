import { Test, TestingModule } from "@nestjs/testing";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import {
  KyvernoAdapter,
  generateDeterministicViolationId,
} from "../kubernetes/kyverno.adapter";
import { K8sLeaderElectorService } from "../kubernetes/coordination/k8s-leader-elector.service";
import { PrismaService } from "../prisma/prisma.service";
import { ViolationSeverityFilter } from "./dto/list-violations-query.dto";
import { VIOLATION_ERROR } from "./violation.errors";
import { ViolationsService } from "./violations.service";

describe("ViolationsService", () => {
  let service: ViolationsService;
  let mockClusterProvider: Partial<ClusterProvider>;
  let mockKyvernoAdapter: Partial<KyvernoAdapter>;
  let mockLeaderElector: Partial<K8sLeaderElectorService>;
  let mockPrismaService: {
    violationHistory: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    policyExceptionRequest: {
      findMany: jest.Mock;
    };
    auditLog: {
      findMany: jest.Mock;
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
        update: jest.fn().mockResolvedValue({ id: "db-vio-1" }),
      },
      policyExceptionRequest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "audit-1" }),
      },
    };

    mockLeaderElector = {
      isCurrentLeader: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ViolationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ClusterProvider, useValue: mockClusterProvider },
        { provide: KyvernoAdapter, useValue: mockKyvernoAdapter },
        { provide: K8sLeaderElectorService, useValue: mockLeaderElector },
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

    it("동일 이름의 PolicyReport가 다른 네임스페이스에 존재해도 위반 ID가 충돌하지 않는다", async () => {
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
            resources: [
              { apiVersion: "v1", kind: "Pod", name: "load-pod", namespace },
            ],
          },
        ],
      });

      mockKyvernoAdapter.listNamespacedPolicyReports = jest
        .fn()
        .mockResolvedValue([
          makeReport("pac-final-bench-0905"),
          makeReport("pac-report-bench-0905"),
        ]);
      mockKyvernoAdapter.listClusterPolicyReports = jest
        .fn()
        .mockResolvedValue([]);

      const result = await service.list(mockUser, { clusterId: "cluster-1" });

      expect(result).toHaveLength(2);
      const ids = result.map((v) => v.id);
      // 두 위반의 ID는 네임스페이스가 포함된 불변 필드 기반 결정론적 해시로 생성되어 서로 달라야 한다.
      expect(new Set(ids).size).toBe(2);
      expect(ids[0]).toMatch(/^viol-[a-f0-9]{16}$/);
      expect(ids[1]).toMatch(/^viol-[a-f0-9]{16}$/);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe("getDetail", () => {
    it("PolicyReport 단건 위반 상세와 추천 해결 가이드, 감사 이벤트를 정상 반환한다", async () => {
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
      expect(detail.events).toBeDefined();
      expect(detail.events?.length).toBeGreaterThan(0);
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

    it("targetClusterId가 'default'로 저장된 DB Fallback UUID 기록도 정상 조회한다", async () => {
      mockPrismaService.violationHistory.findUnique.mockResolvedValueOnce({
        id: "b7de0cc4-2156-4de0-980d-13d7e6cd4073",
        policyName: "require-resource-limits",
        ruleName: "autogen-validate-resource-requests-limits",
        targetClusterId: "default",
        targetClusterDisplayName: "default",
        namespace: "kube-system",
        resourceKind: "Unknown",
        resourceName: "Unknown",
        severity: "medium",
        status: "open",
        message: "validation error",
        occurredAt: new Date("2026-08-30T13:26:22Z"),
      });

      const detail = await service.getDetail(
        "default",
        "b7de0cc4-2156-4de0-980d-13d7e6cd4073",
        mockUser,
      );

      expect(detail).toBeDefined();
      expect(detail.id).toBe("b7de0cc4-2156-4de0-980d-13d7e6cd4073");
      expect(detail.policyName).toBe("require-resource-limits");
    });

    it("네임스페이스를 포함한 신규 ID로 정확한 네임스페이스의 보고서를 조회한다", async () => {
      const makeReport = (namespace: string, policy: string) => ({
        metadata: {
          name: "controlled-load",
          namespace,
          creationTimestamp: "2026-08-19T05:30:00Z",
        },
        results: [
          {
            policy,
            rule: "require-image-tag",
            severity: "high",
            result: "fail",
            message: "Using the :latest tag is prohibited.",
            resources: [
              { apiVersion: "v1", kind: "Pod", name: "load-pod", namespace },
            ],
          },
        ],
      });

      mockKyvernoAdapter.listNamespacedPolicyReports = jest
        .fn()
        .mockResolvedValue([
          makeReport("pac-final-bench-0905", "policy-final"),
          makeReport("pac-report-bench-0905", "policy-report"),
        ]);

      // 첫 번째가 아닌 두 번째(pac-report-bench-0905) 네임스페이스 보고서로 정확히 해석되어야 한다.
      const detail = await service.getDetail(
        "cluster-1",
        "cluster-1:pac-report-bench-0905/controlled-load:0",
        mockUser,
      );

      expect(detail.namespace).toBe("pac-report-bench-0905");
      expect(detail.policyName).toBe("policy-report");
    });

    it("결정론적 ID(viol-*)로 라이브 PolicyReport에서 위반 항목을 성공적으로 매칭하여 상세를 반환한다", async () => {
      const deterministicId = generateDeterministicViolationId(
        "cluster-1",
        "disallow-latest-tag",
        "require-image-tag",
        "Pod",
        "payments",
        "payment-api-pod",
      );

      const detail = await service.getDetail(
        "cluster-1",
        deterministicId,
        mockUser,
      );

      expect(detail).toBeDefined();
      expect(detail.id).toBe(deterministicId);
      expect(detail.policyName).toBe("disallow-latest-tag");
      expect(detail.resourceName).toBe("payment-api-pod");
      expect(detail.namespace).toBe("payments");
    });

    it("결정론적 ID(viol-*)가 라이브에 없을 때 DB Fallback으로 상세를 반환한다", async () => {
      const deterministicId = "viol-abcdef1234567890";
      (
        mockKyvernoAdapter.listClusterPolicyReports as jest.Mock
      ).mockResolvedValueOnce([]);
      (
        mockKyvernoAdapter.listNamespacedPolicyReports as jest.Mock
      ).mockResolvedValueOnce([]);

      mockPrismaService.violationHistory.findUnique.mockResolvedValueOnce({
        id: deterministicId,
        policyName: "disallow-latest-tag",
        ruleName: "require-image-tag",
        targetClusterId: "cluster-1",
        targetClusterDisplayName: "Cluster One",
        resourceName: "payment-api-pod",
        resourceKind: "Pod",
        namespace: "payments",
        severity: "high",
        status: "open",
        occurredAt: new Date("2026-08-19T05:30:00Z"),
      });

      const detail = await service.getDetail(
        "cluster-1",
        deterministicId,
        mockUser,
      );

      expect(detail).toBeDefined();
      expect(detail.id).toBe(deterministicId);
      expect(detail.reportName).toBe("db-fallback");
    });
  });

  describe("updateStatus", () => {
    it("위반 상태를 'resolved'로 업데이트하고 DB 저장 및 감사 로그를 생성한다", async () => {
      const result = await service.updateStatus(
        "cluster-1",
        "cluster-1:polr-ns-payments:0",
        { status: "resolved", note: "리소스 limits 매니페스트 수정 완료" },
        mockUser,
      );

      expect(result).toBeDefined();
      expect(result.status).toBe("resolved");
      expect(mockPrismaService.violationHistory.create).toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "VIOLATION_STATUS_UPDATED",
            entityType: "POLICY_VIOLATION",
            entityId: "cluster-1:polr-ns-payments:0",
            userId: mockUser.id,
          }),
        }),
      );
    });

    it("기존 DB 레코드가 있는 경우 update를 수행한다", async () => {
      mockPrismaService.violationHistory.findFirst.mockResolvedValueOnce({
        id: "existing-vio-1",
        targetClusterId: "cluster-1",
        policyName: "disallow-latest-tag",
        status: "open",
      });

      const result = await service.updateStatus(
        "cluster-1",
        "cluster-1:polr-ns-payments:0",
        { status: "inReview", note: "담당자 검토 진행 중" },
        mockUser,
      );

      expect(result.status).toBe("inReview");
      expect(mockPrismaService.violationHistory.update).toHaveBeenCalledWith({
        where: { id: "existing-vio-1" },
        data: {
          status: "inReview",
          resourceKind: "Pod",
          resourceName: "payment-api-pod",
        },
      });
      expect(mockPrismaService.auditLog.create).toHaveBeenCalled();
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

    it("예외 신청이 존재하더라도 이미 'resolved'로 처리된 DB 기록의 상태를 덮어쓰지 않는다", async () => {
      (
        mockKyvernoAdapter.listClusterPolicyReports as jest.Mock
      ).mockRejectedValue(new Error("K8s cluster unreachable"));
      (
        mockKyvernoAdapter.listNamespacedPolicyReports as jest.Mock
      ).mockRejectedValue(new Error("K8s cluster unreachable"));

      mockPrismaService.violationHistory.findMany.mockResolvedValueOnce([
        {
          id: "db-vio-002",
          policyName: "disallow-latest-tag",
          ruleName: "require-image-tag",
          targetClusterId: "cluster-1",
          targetClusterDisplayName: "Cluster One",
          resourceName: "payment-api-pod",
          namespace: "payments",
          status: "resolved",
          occurredAt: new Date("2026-08-19T05:30:00Z"),
        },
      ]);

      mockPrismaService.policyExceptionRequest.findMany.mockResolvedValueOnce([
        {
          id: "exc-001",
          targetClusterId: "cluster-1",
          policyName: "disallow-latest-tag",
          resourceName: "payment-api-pod",
          resourceNamespace: "payments",
          status: "PENDING",
        },
      ]);

      const result = await service.getViolations(mockUser, {});

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("resolved");
      expect(result[0].exceptionStatus).toBe("requested");
    });

    it("K8s 라이브 리포트 외에 타 클러스터에서 발생하여 DB에만 존재하는 위반 이력을 정상적으로 병합하여 반환한다", async () => {
      // cluster-1, 2, 3의 K8s 호출은 빈 배열 반환
      (
        mockKyvernoAdapter.listClusterPolicyReports as jest.Mock
      ).mockResolvedValue([]);
      (
        mockKyvernoAdapter.listNamespacedPolicyReports as jest.Mock
      ).mockResolvedValue([]);

      // DB에는 타 클러스터(spoke-cluster)에서 발생한 위반이 저장되어 있는 상황
      mockPrismaService.violationHistory.findMany.mockResolvedValueOnce([
        {
          id: "viol-spoke-1",
          policyName: "disallow-privileged-containers",
          ruleName: "privileged-containers",
          targetClusterId: "kyverno-eks-spoke-01",
          targetClusterDisplayName: "Spoke Production Cluster",
          resourceName: "crawler-worker",
          namespace: "default",
          severity: "high",
          status: "open",
          occurredAt: new Date("2026-08-20T00:00:00Z"),
        },
      ]);

      const result = await service.getViolations(mockUser, {});

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("viol-spoke-1");
      expect(result[0].clusterId).toBe("kyverno-eks-spoke-01");
      expect(result[0].clusterDisplayName).toBe("Spoke Production Cluster");
      expect(result[0].policyName).toBe("disallow-privileged-containers");
    });

    it("관리자가 미등록 클러스터 ID로 필터 조회 시에도 가상 메타데이터를 통해 DB 조회를 성공한다", async () => {
      (
        mockKyvernoAdapter.listClusterPolicyReports as jest.Mock
      ).mockRejectedValue(new Error("Cluster not found"));
      (
        mockKyvernoAdapter.listNamespacedPolicyReports as jest.Mock
      ).mockRejectedValue(new Error("Cluster not found"));

      mockPrismaService.violationHistory.findMany.mockResolvedValueOnce([
        {
          id: "viol-remote-99",
          policyName: "require-resource-limits",
          ruleName: "limits-check",
          targetClusterId: "unregistered-remote-cluster",
          targetClusterDisplayName: "Unregistered Remote",
          resourceName: "api-gateway",
          namespace: "prod",
          severity: "medium",
          status: "open",
          occurredAt: new Date("2026-08-20T01:00:00Z"),
        },
      ]);

      const adminUser = { ...mockUser, role: Role.ADMIN };
      const result = await service.getViolations(adminUser, {
        clusterId: "unregistered-remote-cluster",
      });

      expect(result).toHaveLength(1);
      expect(result[0].clusterId).toBe("unregistered-remote-cluster");
      expect(result[0].resourceName).toBe("api-gateway");
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
          id: "cluster-1:cpolr-cluster:0",
          targetClusterId: "cluster-1",
          targetClusterDisplayName: "Cluster One",
          policyName: "require-ro-rootfs",
          ruleName: "check-read-only-root-filesystem",
          namespace: "cluster-wide",
          resourceKind: "Deployment",
          resourceName: "batch-worker",
          severity: "critical",
          status: "open",
          message: "rootFS must be read-only",
          occurredAt: new Date("2026-08-19T05:30:00.000Z"),
        },
      });
    });

    it("기존 DB 레코드가 있는 경우 관리자가 수정한 상태를 보존하며 메타데이터만 업데이트한다", async () => {
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
          message: "rootFS must be read-only (updated)",
          detectedAt: "2026-08-19T06:00:00.000Z",
          reportName: "cpolr-cluster",
        },
      ]);
      (mockKyvernoAdapter.getPolicyReports as jest.Mock).mockResolvedValueOnce(
        [],
      );

      mockPrismaService.violationHistory.findFirst.mockResolvedValueOnce({
        id: "existing-vio-1",
        status: "inReview",
      });

      await service.syncLiveViolations();

      expect(mockPrismaService.violationHistory.update).toHaveBeenCalledWith({
        where: { id: "existing-vio-1" },
        data: {
          targetClusterDisplayName: "Cluster One",
          resourceKind: "Deployment",
          severity: "critical",
          message: "rootFS must be read-only (updated)",
          occurredAt: new Date("2026-08-19T06:00:00.000Z"),
        },
      });
    });

    it("리더십이 없는 경우(isCurrentLeader=false) 동기화를 수행하지 않고 즉시 종료한다", async () => {
      (mockLeaderElector.isCurrentLeader as jest.Mock).mockReturnValue(false);

      await service.syncLiveViolations();

      expect(mockKyvernoAdapter.getClusterPolicyReports).not.toHaveBeenCalled();
      expect(mockKyvernoAdapter.getPolicyReports).not.toHaveBeenCalled();
      expect(mockPrismaService.violationHistory.create).not.toHaveBeenCalled();
    });

    it("autogen- 접두사가 붙은 K8s 리포트 규칙에 대해서도 DB의 정규화된 상태를 올바르게 매핑한다", async () => {
      // K8s 라이브 리포트에는 autogen-require-image-tag 로 규칙명이 들어옴
      mockKyvernoAdapter.listNamespacedPolicyReports = jest
        .fn()
        .mockResolvedValueOnce([
          {
            metadata: {
              name: "polr-ns-payments",
              namespace: "payments",
              creationTimestamp: "2026-08-19T05:30:00Z",
            },
            results: [
              {
                policy: "disallow-latest-tag",
                rule: "autogen-require-image-tag",
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
              },
            ],
          },
        ]);
      mockKyvernoAdapter.listClusterPolicyReports = jest
        .fn()
        .mockResolvedValueOnce([]);

      // DB에는 autogen 접두사 없는 require-image-tag 로 'resolved' 저장되어 있음
      mockPrismaService.violationHistory.findMany.mockResolvedValueOnce([
        {
          id: "db-uuid-1234",
          targetClusterId: "cluster-1",
          policyName: "disallow-latest-tag",
          ruleName: "require-image-tag",
          resourceName: "payment-api-pod",
          namespace: "payments",
          status: "resolved",
        },
      ]);

      const result = await service.list(mockUser, { clusterId: "cluster-1" });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("resolved");
    });

    it("동일 정책 아래에서도 리소스 단위로 격리되어 타 리소스의 처리 상태가 전파되지 않는다", async () => {
      mockKyvernoAdapter.listNamespacedPolicyReports = jest
        .fn()
        .mockResolvedValueOnce([
          {
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
              },
            ],
          },
        ]);
      mockKyvernoAdapter.listClusterPolicyReports = jest
        .fn()
        .mockResolvedValueOnce([]);

      // DB 레코드에 다른 리소스(order-processor-deploy)의 상태만 저장된 경우
      mockPrismaService.violationHistory.findMany.mockResolvedValueOnce([
        {
          id: "db-uuid-order-processor",
          targetClusterId: "cluster-1",
          policyName: "disallow-latest-tag",
          ruleName: "require-image-tag",
          resourceName: "order-processor-deploy",
          namespace: "payments",
          status: "inReview",
        },
      ]);

      const result = await service.list(mockUser, { clusterId: "cluster-1" });

      expect(result).toHaveLength(1);
      // payment-api-pod는 타 리소스(order-processor-deploy)의 inReview 상태에 오염되지 않고 open 상태 유지
      expect(result[0].status).toBe("open");
    });
  });
});
