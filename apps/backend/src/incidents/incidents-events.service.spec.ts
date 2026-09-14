import { Test, TestingModule } from "@nestjs/testing";
import { DeploymentIncidentDto } from "./dto/incident-response.dto";
import { IncidentsEventsService } from "./incidents-events.service";
import { RedisService } from "../redis/redis.service";

describe("IncidentsEventsService", () => {
  let service: IncidentsEventsService;
  let mockRedisService: {
    publish: jest.Mock;
    psubscribe: jest.Mock;
    isConnected: jest.Mock;
  };
  let patternHandler:
    | ((pattern: string, channel: string, message: string) => void)
    | null = null;

  const mockIncident: DeploymentIncidentDto = {
    id: "inc-uuid-1",
    clusterId: "cluster-alpha",
    namespace: "production",
    resourceKind: "Deployment",
    resourceName: "order-service",
    policyName: "disallow-privileged",
    ruleName: "check-privileged",
    blockReason: "Privileged containers disallowed",
    status: "ACTIVE",
    blockCount: 1,
    firstBlockedAt: new Date(),
    lastBlockedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    patternHandler = null;

    mockRedisService = {
      publish: jest.fn().mockResolvedValue(1),
      psubscribe: jest.fn().mockImplementation((_pattern, handler) => {
        patternHandler = handler;
        return Promise.resolve();
      }),
      isConnected: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncidentsEventsService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<IncidentsEventsService>(IncidentsEventsService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("Redis Pub/Sub initialization", () => {
    it("subscribes to events:incidents:* pattern on module init", async () => {
      await service.onModuleInit();

      expect(mockRedisService.psubscribe).toHaveBeenCalledWith(
        "events:incidents:*",
        expect.any(Function),
      );
      expect(patternHandler).toBeDefined();
    });
  });

  describe("emitIncidentCreated", () => {
    it("publishes serialized incident to Redis channel events:incidents:<clusterId>", async () => {
      await service.emitIncidentCreated(mockIncident);

      expect(mockRedisService.publish).toHaveBeenCalledTimes(1);
      expect(mockRedisService.publish).toHaveBeenCalledWith(
        "events:incidents:cluster-alpha",
        expect.stringContaining('"eventType":"incident:created"'),
      );
      expect(mockRedisService.publish).toHaveBeenCalledWith(
        "events:incidents:cluster-alpha",
        expect.stringContaining('"id":"inc-uuid-1"'),
      );
    });
  });

  describe("emitIncidentUpdated", () => {
    it("publishes update event to Redis channel", async () => {
      await service.emitIncidentUpdated(mockIncident);

      expect(mockRedisService.publish).toHaveBeenCalledTimes(1);
      expect(mockRedisService.publish).toHaveBeenCalledWith(
        "events:incidents:cluster-alpha",
        expect.stringContaining('"eventType":"incident:updated"'),
      );
    });
  });

  describe("subscribe and message relay", () => {
    it("relays Redis incoming messages to subscribed clients and applies cluster filtering", (done) => {
      void service.onModuleInit().then(() => {
        const stream$ = service.subscribe(["cluster-alpha"], false);

        stream$.subscribe((event) => {
          const payload = event.data as unknown as {
            incident: DeploymentIncidentDto;
          };
          expect(event.id).toBe("inc-uuid-1");
          expect(event.type).toBe("incident:created");
          expect(payload.incident.clusterId).toBe("cluster-alpha");
          done();
        });

        // Redis 수신 이벤트 시뮬레이션
        patternHandler!(
          "events:incidents:*",
          "events:incidents:cluster-alpha",
          JSON.stringify({
            eventType: "incident:created",
            incident: mockIncident,
            timestamp: new Date().toISOString(),
          }),
        );
      });
    });

    it("filters out events from unauthorized clusters for non-admin users", (done) => {
      void service.onModuleInit().then(() => {
        // user only has access to cluster-beta
        const stream$ = service.subscribe(["cluster-beta"], false);

        const receivedEvents: any[] = [];
        stream$.subscribe((event) => {
          receivedEvents.push(event);
        });

        // unauthorized event for cluster-alpha
        patternHandler!(
          "events:incidents:*",
          "events:incidents:cluster-alpha",
          JSON.stringify({
            eventType: "incident:created",
            incident: mockIncident, // clusterId is cluster-alpha
            timestamp: new Date().toISOString(),
          }),
        );

        setTimeout(() => {
          expect(receivedEvents.length).toBe(0);
          done();
        }, 50);
      });
    });

    it("delivers all cluster events to ADMIN role", (done) => {
      void service.onModuleInit().then(() => {
        const stream$ = service.subscribe([], true); // isAdmin = true

        stream$.subscribe((event) => {
          expect(event.id).toBe("inc-uuid-1");
          done();
        });

        patternHandler!(
          "events:incidents:*",
          "events:incidents:cluster-alpha",
          JSON.stringify({
            eventType: "incident:created",
            incident: mockIncident,
            timestamp: new Date().toISOString(),
          }),
        );
      });
    });
  });

  describe("Graceful fallback without Redis", () => {
    it("dispatches events locally via Subject when Redis is not provided", (done) => {
      const fallbackService = new IncidentsEventsService(undefined);

      const stream$ = fallbackService.subscribe(["cluster-alpha"], false);
      stream$.subscribe((event) => {
        expect(event.id).toBe("inc-uuid-1");
        done();
      });

      void fallbackService.emitIncidentCreated(mockIncident);
    });
  });
});
