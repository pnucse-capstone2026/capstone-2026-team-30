import { Test, TestingModule } from "@nestjs/testing";
import { IdleWorkloadMonitorService } from "./idle-workload-monitor.service";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { KubeflowAdapter } from "../notebooks/kubeflow.adapter";
import { MlGovernanceEventBus } from "./ml-governance-event-bus.service";

describe("IdleWorkloadMonitorService", () => {
  let service: IdleWorkloadMonitorService;
  let kubeflowAdapter: jest.Mocked<KubeflowAdapter>;
  let eventBus: MlGovernanceEventBus;

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
            name: "idle-notebook",
            namespace: "default",
            creationTimestamp: new Date(
              Date.now() - 5 * 3600 * 1000,
            ).toISOString(),
          },
          spec: { template: { spec: { containers: [] } } },
        },
        {
          metadata: {
            name: "active-notebook",
            namespace: "default",
            annotations: {
              "mlops.governance.io/last-activity": new Date().toISOString(),
            },
          },
          spec: { template: { spec: { containers: [] } } },
        },
      ]),
      stopNotebook: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdleWorkloadMonitorService,
        MlGovernanceEventBus,
        { provide: ClusterProvider, useValue: mockClusterProvider },
        { provide: KubeflowAdapter, useValue: mockKubeflowAdapter },
      ],
    }).compile();

    service = module.get<IdleWorkloadMonitorService>(
      IdleWorkloadMonitorService,
    );
    kubeflowAdapter = module.get(KubeflowAdapter);
    eventBus = module.get<MlGovernanceEventBus>(MlGovernanceEventBus);
  });

  it("should return current settings and allow updating settings", () => {
    const settings = service.getSettings();
    expect(settings.idleThresholdHours).toBe(2);
    expect(settings.autoStopEnabled).toBe(true);

    const updated = service.updateSettings({ idleThresholdHours: 4 });
    expect(updated.idleThresholdHours).toBe(4);
  });

  it("should throw error if updated threshold is non-positive", () => {
    expect(() => service.updateSettings({ idleThresholdHours: 0 })).toThrow();
  });

  it("should inspect idle notebooks and trigger stopNotebook when threshold is exceeded and emit event", async () => {
    const emittedEvents: any[] = [];
    eventBus.asObservable().subscribe((e) => emittedEvents.push(e));

    const result = await service.checkAndShutdownIdleNotebooks(
      "default",
      "default",
    );

    expect(result.scannedCount).toBe(2);
    expect(result.idleDetectedCount).toBe(1);
    expect(result.autoStoppedCount).toBe(1);
    expect(kubeflowAdapter.stopNotebook).toHaveBeenCalledWith(
      "default",
      "default",
      "idle-notebook",
    );
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].type).toBe("governance-updated");
  });

  it("should skip stopping notebooks when autoStopEnabled is false", async () => {
    service.updateSettings({ autoStopEnabled: false });
    const result = await service.checkAndShutdownIdleNotebooks(
      "default",
      "default",
    );

    expect(result.idleDetectedCount).toBe(1);
    expect(result.autoStoppedCount).toBe(0);
    expect(kubeflowAdapter.stopNotebook).not.toHaveBeenCalled();
  });
});
