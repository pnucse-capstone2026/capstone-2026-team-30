import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import { MlGovernanceService } from "./ml-governance.service";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { KubeflowAdapter } from "../notebooks/kubeflow.adapter";
import { KyvernoAdapter } from "../../kubernetes/kyverno.adapter";
import { GpuQuotaService } from "./gpu-quota.service";
import { IdleWorkloadMonitorService } from "./idle-workload-monitor.service";
import { MlGovernanceEventBus } from "./ml-governance-event-bus.service";
import { AuthenticatedUser } from "../../auth/auth.types";

describe("MlGovernanceService", () => {
  let service: MlGovernanceService;
  let kyvernoAdapter: jest.Mocked<KyvernoAdapter>;
  let eventBus: MlGovernanceEventBus;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "user@example.com",
    role: "ADMIN",
    clusterIds: ["default"],
  };

  beforeEach(async () => {
    const mockClusterProvider = {
      list: jest
        .fn()
        .mockReturnValue([{ id: "default", displayName: "Local Cluster" }]),
    };

    const mockKubeflowAdapter = {
      listNotebooks: jest.fn().mockResolvedValue([
        {
          metadata: {
            name: "nb-1",
            namespace: "default",
            creationTimestamp: new Date(
              Date.now() - 3 * 3600 * 1000,
            ).toISOString(),
          },
        },
        {
          metadata: {
            name: "nb-stopped",
            namespace: "default",
            annotations: { "kubeflow-resource-stopped": "true" },
          },
        },
      ]),
      watchNotebooks: jest.fn().mockReturnValue(
        of({
          type: "MODIFIED",
          object: {
            metadata: { name: "nb-1", namespace: "default" },
          },
        }),
      ),
    };

    const mockKyvernoAdapter = {
      listNamespacedPolicyReports: jest.fn().mockResolvedValue([
        {
          metadata: { name: "report-1", namespace: "default" },
          results: [
            {
              policy: "limit-gpu-per-namespace",
              rule: "check-gpu-limits",
              severity: "high",
              result: "fail",
              message: "GPU limit exceeded",
              resources: [
                { kind: "Pod", name: "heavy-gpu-pod", namespace: "default" },
              ],
            },
          ],
        },
      ]),
    };

    const mockGpuQuotaService = {
      getGpuQuotaStatus: jest.fn().mockResolvedValue({
        clusterId: "default",
        namespace: "default",
        totalLimit: 16,
        usedGpus: 4,
        availableGpus: 12,
        usagePercentage: 25,
      }),
    };

    const mockIdleMonitorService = {
      getSettings: jest.fn().mockReturnValue({ idleThresholdHours: 2 }),
      getCumulativeStoppedCount: jest.fn().mockReturnValue(2),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MlGovernanceService,
        MlGovernanceEventBus,
        { provide: ClusterProvider, useValue: mockClusterProvider },
        { provide: KubeflowAdapter, useValue: mockKubeflowAdapter },
        { provide: KyvernoAdapter, useValue: mockKyvernoAdapter },
        { provide: GpuQuotaService, useValue: mockGpuQuotaService },
        {
          provide: IdleWorkloadMonitorService,
          useValue: mockIdleMonitorService,
        },
      ],
    }).compile();

    service = module.get<MlGovernanceService>(MlGovernanceService);
    kyvernoAdapter = module.get(KyvernoAdapter);
    eventBus = module.get<MlGovernanceEventBus>(MlGovernanceEventBus);
  });

  it("should return governance overview with cost savings and notebooks counts", async () => {
    const overview = await service.getGovernanceOverview("default", "default");

    expect(overview.clusterId).toBe("default");
    expect(overview.notebooks.total).toBe(2);
    expect(overview.notebooks.stopped).toBe(1);
    expect(overview.costSavings.autoStoppedCount).toBe(3); // 2 cumulative + 1 stopped
    expect(overview.costSavings.estimatedDailySavingsUsd).toBeGreaterThan(0);
    expect(overview.policyViolationsCount).toBe(1);
  });

  it("should fetch ML policy violations and attach remediation guidance", async () => {
    const violations = await service.getMlPolicyViolations(
      "default",
      "default",
    );

    expect(violations.length).toBe(1);
    expect(violations[0].policyName).toBe("limit-gpu-per-namespace");
    expect(violations[0].remediation).toContain("8개 이하로 조정하세요");
    expect(kyvernoAdapter.listNamespacedPolicyReports).toHaveBeenCalledWith(
      "default",
      "default",
    );
  });

  it("동일 이름의 PolicyReport가 다른 네임스페이스에 존재해도 ML 위반 ID가 충돌하지 않는다", async () => {
    // namespace 미지정 시 전체 네임스페이스의 PolicyReport가 수집되며,
    // 동일 metadata.name을 가진 보고서가 서로 다른 네임스페이스에 존재할 수 있다.
    const makeReport = (namespace: string) => ({
      metadata: { name: "gpu-report", namespace },
      results: [
        {
          policy: "limit-gpu-per-namespace",
          rule: "check-gpu-limits",
          severity: "high",
          result: "fail",
          message: "GPU limit exceeded",
          resources: [{ kind: "Pod", name: "heavy-gpu-pod", namespace }],
        },
      ],
    });

    kyvernoAdapter.listNamespacedPolicyReports.mockResolvedValue([
      makeReport("team-a"),
      makeReport("team-b"),
    ] as never);

    const violations = await service.getMlPolicyViolations("default");

    expect(violations).toHaveLength(2);
    const ids = violations.map((v) => v.id);
    // 두 위반의 ID는 네임스페이스가 포함되어 서로 달라야 한다.
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("default:team-a/gpu-report:0");
    expect(ids).toContain("default:team-b/gpu-report:0");
  });

  it("should subscribe to governance events and receive watch & bus events", (done) => {
    const events: any[] = [];
    const stream = service.subscribeEvents("default", "default", mockUser);

    const sub = stream.subscribe({
      next: (event) => {
        events.push(event);
        if (events.length === 2) {
          expect(events[0].type).toBe("governance-updated");
          expect(events[1].type).toBe("gpu-quota-changed");
          sub.unsubscribe();
          done();
        }
      },
    });

    // Emit event via eventBus
    eventBus.emit("gpu-quota-changed", { usedGpus: 6 }, "default", "default");
  });
});
