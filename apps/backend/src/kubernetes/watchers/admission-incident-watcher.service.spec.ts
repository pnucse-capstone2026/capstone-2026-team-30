import { Test, TestingModule } from "@nestjs/testing";
import { CoreV1Event } from "@kubernetes/client-node";
import { IncidentsService } from "../../incidents/incidents.service";
import { ClusterProvider } from "../cluster-provider";
import { AdmissionIncidentWatcherService } from "./admission-incident-watcher.service";
import { CoreEventIncidentDetector } from "./detectors/k8s-core-event.detector";
import { ArgoCdIncidentDetector } from "./detectors/argocd.detector";
import { FluxCdIncidentDetector } from "./detectors/fluxcd.detector";
import { K8sLeaderElectorService } from "../coordination/k8s-leader-elector.service";

describe("AdmissionIncidentWatcherService", () => {
  let service: AdmissionIncidentWatcherService;
  let coreEventDetector: CoreEventIncidentDetector;
  let argoCdDetector: ArgoCdIncidentDetector;
  let mockIncidentsService: {
    recordAdmissionBlock: jest.Mock;
  };
  let mockClusterProvider: Partial<ClusterProvider>;

  beforeEach(async () => {
    mockIncidentsService = {
      recordAdmissionBlock: jest.fn().mockResolvedValue({ id: "inc-1" }),
    };

    mockClusterProvider = {
      list: jest.fn().mockReturnValue([
        {
          id: "cluster-alpha",
          displayName: "Alpha",
          exceptionNamespace: "kyverno",
        },
      ]),
      getKubeConfig: jest.fn().mockImplementation(() => {
        throw new Error("No real cluster in test");
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdmissionIncidentWatcherService,
        CoreEventIncidentDetector,
        ArgoCdIncidentDetector,
        FluxCdIncidentDetector,
        { provide: IncidentsService, useValue: mockIncidentsService },
        { provide: ClusterProvider, useValue: mockClusterProvider },
      ],
    }).compile();

    service = module.get<AdmissionIncidentWatcherService>(
      AdmissionIncidentWatcherService,
    );
    coreEventDetector = module.get<CoreEventIncidentDetector>(
      CoreEventIncidentDetector,
    );
    argoCdDetector = module.get<ArgoCdIncidentDetector>(ArgoCdIncidentDetector);
  });

  describe("parseAdmissionBlockMessage", () => {
    it("parses bracketed policy and rule name correctly", () => {
      const msg =
        'admission webhook "validate.kyverno.svc" denied the request: [disallow-privileged-containers/check-privileged] Privileged containers are not allowed.';
      const result = service.parseAdmissionBlockMessage(msg);

      expect(result.policyName).toBe("disallow-privileged-containers");
      expect(result.ruleName).toBe("check-privileged");
      expect(result.cleanReason).toBe(
        "[disallow-privileged-containers/check-privileged] Privileged containers are not allowed.",
      );
    });

    it("parses bracketed policy name without rule correctly", () => {
      const msg =
        'admission webhook "validate.kyverno.svc" denied the request: [require-labels] Labels are required.';
      const result = service.parseAdmissionBlockMessage(msg);

      expect(result.policyName).toBe("require-labels");
      expect(result.ruleName).toBeUndefined();
      expect(result.cleanReason).toBe("[require-labels] Labels are required.");
    });

    it("parses blocked due to following policies multi-line format", () => {
      const msg =
        'admission webhook "validate.kyverno.svc" denied the request: resource Deployment/test/app was blocked due to the following policies\n\nrequire-labels:\n  check-team: "autogen-check-team" is required';
      const result = service.parseAdmissionBlockMessage(msg);

      expect(result.policyName).toBe("require-labels");
      expect(result.ruleName).toBe("check-team");
    });
  });

  describe("isKyvernoAdmissionDenial", () => {
    it("returns true when reason is AdmissionWebhookDenied", () => {
      expect(
        service.isKyvernoAdmissionDenial(
          "any message",
          "AdmissionWebhookDenied",
        ),
      ).toBe(true);
    });

    it("returns true when message mentions kyverno and admission webhook denial", () => {
      const msg =
        'admission webhook "validate.kyverno.svc" denied the request: [require-labels] missing label';
      expect(service.isKyvernoAdmissionDenial(msg)).toBe(true);
    });

    it("returns false for regular sync errors unrelated to kyverno", () => {
      const msg = "error: resource mapping not found";
      expect(service.isKyvernoAdmissionDenial(msg, "SyncFailed")).toBe(false);
    });
  });

  describe("ArgoCdIncidentDetector", () => {
    it("extracts blocked resource from syncResult and forwards with gitopsAppName", async () => {
      const mockApp = {
        metadata: { name: "payment-service" },
        spec: {
          destination: { namespace: "payments" },
          source: {
            repoURL: "https://github.com/org/gitops-payments",
            targetRevision: "main",
          },
        },
        status: {
          operationState: {
            syncResult: {
              revision: "sha-12345",
              resources: [
                {
                  kind: "Deployment",
                  name: "payment-api",
                  namespace: "payments",
                  status: "SyncFailed",
                  message:
                    'admission webhook "validate.kyverno.svc" denied the request: [disallow-privileged-containers/check-privileged] Privileged containers disallowed',
                },
                {
                  kind: "Service",
                  name: "payment-svc",
                  namespace: "payments",
                  status: "Synced",
                  message: "",
                },
              ],
            },
          },
        },
      };

      const handleIncident = jest.fn();
      await (argoCdDetector as any).processApplication(
        "cluster-alpha",
        mockApp,
        handleIncident,
      );

      expect(handleIncident).toHaveBeenCalledTimes(1);
      expect(handleIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: "cluster-alpha",
          namespace: "payments",
          resourceKind: "Deployment",
          resourceName: "payment-api",
          policyName: "disallow-privileged-containers",
          ruleName: "check-privileged",
          gitopsAppName: "payment-service",
          gitCommitSha: "sha-12345",
          gitRepository: "https://github.com/org/gitops-payments",
        }),
      );
    });
  });

  describe("CoreEventIncidentDetector", () => {
    it("processes AdmissionWebhookDenied core event and forwards to incident handler", async () => {
      const mockEvent: CoreV1Event = {
        metadata: { name: "event-1" },
        reason: "AdmissionWebhookDenied",
        message:
          'admission webhook "validate.kyverno.svc" denied the request: [require-run-as-non-root] runAsNonRoot must be true',
        involvedObject: {
          kind: "Pod",
          name: "batch-worker-0",
          namespace: "data-pipeline",
        },
        count: 3,
        firstTimestamp: new Date(),
        lastTimestamp: new Date(),
      };

      const handleIncident = jest.fn();
      await (coreEventDetector as any).processEvent(
        "cluster-alpha",
        mockEvent,
        handleIncident,
      );

      expect(handleIncident).toHaveBeenCalledTimes(1);
      expect(handleIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: "cluster-alpha",
          namespace: "data-pipeline",
          resourceKind: "Pod",
          resourceName: "batch-worker-0",
          policyName: "require-run-as-non-root",
        }),
      );
    });
  });

  describe("Leader Election Lifecycle Integration", () => {
    it("starts watchers when leader is acquired and stops when leader is lost", async () => {
      let acquiredCallback: () => void = () => {};
      let lostCallback: () => void = () => {};

      const mockLeaderElector = {
        onLeaderAcquired: jest.fn().mockImplementation((cb) => {
          acquiredCallback = cb;
        }),
        onLeaderLost: jest.fn().mockImplementation((cb) => {
          lostCallback = cb;
        }),
      };

      const watcherService = new AdmissionIncidentWatcherService(
        mockIncidentsService as any,
        coreEventDetector,
        argoCdDetector,
        new FluxCdIncidentDetector(),
        mockClusterProvider as ClusterProvider,
        mockLeaderElector as unknown as K8sLeaderElectorService,
      );

      const startSpy = jest.spyOn(watcherService, "start");
      const stopSpy = jest.spyOn(watcherService, "stop");

      await watcherService.onModuleInit();

      expect(mockLeaderElector.onLeaderAcquired).toHaveBeenCalledTimes(1);
      expect(mockLeaderElector.onLeaderLost).toHaveBeenCalledTimes(1);
      expect(startSpy).not.toHaveBeenCalled();

      // 리더 획득 이벤트 발생
      acquiredCallback();
      expect(startSpy).toHaveBeenCalledTimes(1);

      // 리더 상실 이벤트 발생
      lostCallback();
      expect(stopSpy).toHaveBeenCalledTimes(1);

      // 모듈 종료 시 stop 호출
      await watcherService.onModuleDestroy();
      expect(stopSpy).toHaveBeenCalledTimes(2);
    });
  });
});
