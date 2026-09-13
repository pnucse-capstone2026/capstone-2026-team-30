import { Test, TestingModule } from "@nestjs/testing";
import { CoreV1Event } from "@kubernetes/client-node";
import { IncidentsService } from "../../incidents/incidents.service";
import { ClusterProvider } from "../cluster-provider";
import { AdmissionIncidentWatcherService } from "./admission-incident-watcher.service";

describe("AdmissionIncidentWatcherService", () => {
  let service: AdmissionIncidentWatcherService;
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
        { provide: IncidentsService, useValue: mockIncidentsService },
        { provide: ClusterProvider, useValue: mockClusterProvider },
      ],
    }).compile();

    service = module.get<AdmissionIncidentWatcherService>(
      AdmissionIncidentWatcherService,
    );
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

  describe("processArgoApplication", () => {
    it("extracts blocked resource from syncResult and forwards to incidentsService", async () => {
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

      await service.processArgoApplication("cluster-alpha", mockApp as any);

      expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledTimes(
        1,
      );
      expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          clusterId: "cluster-alpha",
          namespace: "payments",
          resourceKind: "Deployment",
          resourceName: "payment-api",
          policyName: "disallow-privileged-containers",
          ruleName: "check-privileged",
          argoAppName: "payment-service",
          gitCommitSha: "sha-12345",
          gitRepository: "https://github.com/org/gitops-payments",
        }),
      );
    });
  });

  describe("processCoreEvent", () => {
    it("processes AdmissionWebhookDenied core event and forwards to incidentsService", async () => {
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

      await service.processCoreEvent("cluster-alpha", mockEvent);

      expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledTimes(
        1,
      );
      expect(mockIncidentsService.recordAdmissionBlock).toHaveBeenCalledWith(
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
});
