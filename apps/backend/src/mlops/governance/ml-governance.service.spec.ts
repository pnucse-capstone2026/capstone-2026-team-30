import { Test, TestingModule } from "@nestjs/testing";
import { MlGovernanceService } from "./ml-governance.service";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { KubeflowAdapter } from "../notebooks/kubeflow.adapter";
import { KyvernoAdapter } from "../../kubernetes/kyverno.adapter";
import { GpuQuotaService } from "./gpu-quota.service";
import { IdleWorkloadMonitorService } from "./idle-workload-monitor.service";

describe("MlGovernanceService", () => {
  let service: MlGovernanceService;
  let kyvernoAdapter: jest.Mocked<KyvernoAdapter>;

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
});
