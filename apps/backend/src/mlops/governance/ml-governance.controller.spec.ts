import { Test, TestingModule } from "@nestjs/testing";
import { MlGovernanceController } from "./ml-governance.controller";
import { MlGovernanceService } from "./ml-governance.service";
import { GpuQuotaService } from "./gpu-quota.service";
import { IdleWorkloadMonitorService } from "./idle-workload-monitor.service";
import { AuthenticatedUser } from "../../auth/auth.types";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";

describe("MlGovernanceController", () => {
  let controller: MlGovernanceController;
  let mlGovernanceService: jest.Mocked<MlGovernanceService>;
  let gpuQuotaService: jest.Mocked<GpuQuotaService>;
  let idleMonitorService: jest.Mocked<IdleWorkloadMonitorService>;

  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "user@example.com",
    role: "ADMIN",
    clusterIds: ["default"],
  };

  beforeEach(async () => {
    const mockMlGovernanceService = {
      getGovernanceOverview: jest.fn().mockResolvedValue({
        clusterId: "default",
        namespace: "default",
        gpuQuota: {
          clusterId: "default",
          namespace: "default",
          totalLimit: 16,
          usedGpus: 4,
          availableGpus: 12,
          usagePercentage: 25,
        },
        notebooks: { total: 2, active: 1, idle: 0, stopped: 1 },
        costSavings: {
          estimatedMonthlySavingsUsd: 1350,
          estimatedDailySavingsUsd: 45,
          autoStoppedCount: 2,
        },
        policyViolationsCount: 1,
      }),
      getMlPolicyViolations: jest.fn().mockResolvedValue([]),
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
      getSettings: jest
        .fn()
        .mockReturnValue({ idleThresholdHours: 2, autoStopEnabled: true }),
      updateSettings: jest.fn().mockReturnValue({
        idleThresholdHours: 4,
        autoStopEnabled: true,
      }),
      checkAndShutdownIdleNotebooks: jest.fn().mockResolvedValue({
        scannedCount: 2,
        idleDetectedCount: 1,
        autoStoppedCount: 1,
        stoppedNotebooks: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MlGovernanceController],
      providers: [
        { provide: MlGovernanceService, useValue: mockMlGovernanceService },
        { provide: GpuQuotaService, useValue: mockGpuQuotaService },
        {
          provide: IdleWorkloadMonitorService,
          useValue: mockIdleMonitorService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MlGovernanceController>(MlGovernanceController);
    mlGovernanceService = module.get(MlGovernanceService);
    gpuQuotaService = module.get(GpuQuotaService);
    idleMonitorService = module.get(IdleWorkloadMonitorService);
  });

  it("should return governance overview", async () => {
    const res = await controller.getOverview("default", "default", mockUser);
    expect(res.clusterId).toBe("default");
    expect(mlGovernanceService.getGovernanceOverview).toHaveBeenCalledWith(
      "default",
      "default",
    );
  });

  it("should return GPU quotas", async () => {
    const res = await controller.getGpuQuotas("default", "default", mockUser);
    expect(res.usedGpus).toBe(4);
    expect(gpuQuotaService.getGpuQuotaStatus).toHaveBeenCalledWith(
      "default",
      "default",
    );
  });

  it("should get and update settings", () => {
    const settings = controller.getSettings();
    expect(settings.idleThresholdHours).toBe(2);

    const updated = controller.updateSettings({ idleThresholdHours: 4 });
    expect(updated.idleThresholdHours).toBe(4);
    expect(idleMonitorService.updateSettings).toHaveBeenCalledWith({
      idleThresholdHours: 4,
    });
  });

  it("should trigger manual idle monitor inspection", async () => {
    const res = await controller.triggerIdleMonitor(
      "default",
      "default",
      mockUser,
    );
    expect(res.scannedCount).toBe(2);
    expect(
      idleMonitorService.checkAndShutdownIdleNotebooks,
    ).toHaveBeenCalledWith("default", "default");
  });
});
