import { GUARDS_METADATA } from "@nestjs/common/constants";
import { IncidentStatus, Role } from "@prisma/client";
import { of } from "rxjs";
import { AuthenticatedUser } from "../auth/auth.types";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { IncidentsController } from "./incidents.controller";

describe("IncidentsController", () => {
  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "operator@example.com",
    role: Role.APPROVER,
    clusterIds: ["cluster-alpha"],
  };

  const sampleIncidentDto = {
    id: "inc-1",
    clusterId: "cluster-alpha",
    namespace: "default",
    resourceKind: "Pod",
    resourceName: "test-pod",
    policyName: "require-labels",
    ruleName: "check-team",
    blockReason: "team label is required",
    status: IncidentStatus.ACTIVE,
    blockCount: 1,
    firstBlockedAt: new Date(),
    lastBlockedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("protects every endpoint with JWT and permission guards", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, IncidentsController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it.each([
    ["getIncidents", "incidents.read"],
    ["getIncidentById", "incidents.read"],
    ["subscribeEvents", "incidents.read"],
    ["ignoreIncident", "incidents.manage"],
  ])("declares %s permission as %s", (method, permission) => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        IncidentsController.prototype[method as keyof IncidentsController],
      ),
    ).toEqual([permission]);
  });

  it("delegates getIncidents call to service", async () => {
    const mockService = {
      getIncidents: jest.fn().mockResolvedValue({
        items: [sampleIncidentDto],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
      getIncidentById: jest.fn(),
      ignoreIncident: jest.fn(),
    };
    const mockEventsService = {
      subscribe: jest.fn(),
    };

    const controller = new IncidentsController(
      mockService as any,
      mockEventsService as any,
    );

    const result = await controller.getIncidents(mockUser, { page: 1 });
    expect(result.total).toBe(1);
    expect(mockService.getIncidents).toHaveBeenCalledWith(mockUser, {
      page: 1,
    });
  });

  it("delegates getIncidentById call to service", async () => {
    const mockService = {
      getIncidents: jest.fn(),
      getIncidentById: jest.fn().mockResolvedValue(sampleIncidentDto),
      ignoreIncident: jest.fn(),
    };
    const mockEventsService = {
      subscribe: jest.fn(),
    };

    const controller = new IncidentsController(
      mockService as any,
      mockEventsService as any,
    );

    const result = await controller.getIncidentById(mockUser, "inc-1");
    expect(result).toBe(sampleIncidentDto);
    expect(mockService.getIncidentById).toHaveBeenCalledWith(mockUser, "inc-1");
  });

  it("delegates ignoreIncident call to service", async () => {
    const ignoredDto = { ...sampleIncidentDto, status: IncidentStatus.IGNORED };
    const mockService = {
      getIncidents: jest.fn(),
      getIncidentById: jest.fn(),
      ignoreIncident: jest.fn().mockResolvedValue(ignoredDto),
    };
    const mockEventsService = {
      subscribe: jest.fn(),
    };

    const controller = new IncidentsController(
      mockService as any,
      mockEventsService as any,
    );

    const result = await controller.ignoreIncident(mockUser, "inc-1", {
      reason: "Manual ignore",
    });
    expect(result.status).toBe(IncidentStatus.IGNORED);
    expect(mockService.ignoreIncident).toHaveBeenCalledWith(mockUser, "inc-1", {
      reason: "Manual ignore",
    });
  });

  it("delegates subscribeEvents call to eventsService", (done) => {
    const mockService = {
      getIncidents: jest.fn(),
      getIncidentById: jest.fn(),
      ignoreIncident: jest.fn(),
    };
    const mockEventsService = {
      subscribe: jest.fn().mockReturnValue(of({ data: { test: true } })),
    };

    const controller = new IncidentsController(
      mockService as any,
      mockEventsService as any,
    );

    const stream$ = controller.subscribeEvents(mockUser);
    expect(mockEventsService.subscribe).toHaveBeenCalledWith(
      ["cluster-alpha"],
      false,
    );

    stream$.subscribe((event) => {
      expect(event).toBeDefined();
      done();
    });
  });

  it("hydrates missed events when last-event-id header is provided and hasMore is false", (done) => {
    const pastIncident = {
      ...sampleIncidentDto,
      id: "inc-past-1",
      updatedAt: new Date(),
    };
    const mockService = {
      getIncidentsSince: jest.fn().mockResolvedValue({
        items: [pastIncident],
        hasMore: false,
        lastEventId: "inc-last-0",
      }),
    };
    const mockEventsService = {
      subscribe: jest
        .fn()
        .mockReturnValue(of({ id: "inc-live-1", data: { test: true } })),
    };

    const controller = new IncidentsController(
      mockService as any,
      mockEventsService as any,
    );

    const stream$ = controller.subscribeEvents(mockUser, "inc-last-0");
    expect(mockService.getIncidentsSince).toHaveBeenCalledWith(
      mockUser,
      "inc-last-0",
    );

    const emitted: any[] = [];
    stream$.subscribe({
      next: (event) => emitted.push(event),
      complete: () => {
        expect(emitted.length).toBe(2);
        // 첫 번째 이벤트는 과거 누락분 하이드레이션
        expect(emitted[0].id).toBe("inc-past-1");
        expect(emitted[0].type).toBe("incident:updated");
        // 두 번째 이벤트는 실시간 스트림
        expect(emitted[1].id).toBe("inc-live-1");
        done();
      },
    });
  });

  it("emits resync-required control event when delta hydration exceeds limit (hasMore: true)", (done) => {
    const pastIncidents = Array.from({ length: 100 }, (_, i) => ({
      ...sampleIncidentDto,
      id: `inc-past-${i}`,
      updatedAt: new Date(),
    }));

    const mockService = {
      getIncidentsSince: jest.fn().mockResolvedValue({
        items: pastIncidents,
        hasMore: true,
        lastEventId: "inc-last-0",
      }),
    };
    const mockEventsService = {
      subscribe: jest
        .fn()
        .mockReturnValue(
          of({ id: "inc-live-after-overflow", data: { live: true } }),
        ),
    };

    const controller = new IncidentsController(
      mockService as any,
      mockEventsService as any,
    );

    const stream$ = controller.subscribeEvents(mockUser, "inc-last-0");
    expect(mockService.getIncidentsSince).toHaveBeenCalledWith(
      mockUser,
      "inc-last-0",
    );

    const emitted: any[] = [];
    stream$.subscribe({
      next: (event) => emitted.push(event),
      complete: () => {
        // 100건의 하이드레이션 이벤트 + 1건의 resync-required 제어 이벤트 + 1건의 실시간 이벤트 = 총 102건
        expect(emitted.length).toBe(102);

        // 100건의 인시던트 이벤트
        expect(emitted[0].id).toBe("inc-past-0");
        expect(emitted[99].id).toBe("inc-past-99");

        // 101번째는 resync-required 제어 이벤트
        const controlEvent = emitted[100];
        expect(controlEvent.type).toBe("resync-required");
        expect(controlEvent.data).toEqual({
          reason: "DELTA_BUFFER_OVERFLOW",
          message:
            "Disconnected duration exceeded delta buffer. Full re-synchronization required.",
          count: 100,
        });

        // 102번째는 실시간 스트림 이벤트
        expect(emitted[101].id).toBe("inc-live-after-overflow");
        done();
      },
    });
  });

  it("hydrates missed events when query parameter lastEventId is provided", (done) => {
    const pastIncident = {
      ...sampleIncidentDto,
      id: "inc-past-query-1",
      updatedAt: new Date(),
    };
    const mockService = {
      getIncidentsSince: jest.fn().mockResolvedValue({
        items: [pastIncident],
        hasMore: false,
        lastEventId: "inc-query-0",
      }),
    };
    const mockEventsService = {
      subscribe: jest
        .fn()
        .mockReturnValue(of({ id: "inc-live-query-1", data: { test: true } })),
    };

    const controller = new IncidentsController(
      mockService as any,
      mockEventsService as any,
    );

    const stream$ = controller.subscribeEvents(
      mockUser,
      undefined,
      "inc-query-0",
    );
    expect(mockService.getIncidentsSince).toHaveBeenCalledWith(
      mockUser,
      "inc-query-0",
    );

    const emitted: any[] = [];
    stream$.subscribe({
      next: (event) => emitted.push(event),
      complete: () => {
        expect(emitted.length).toBe(2);
        expect(emitted[0].id).toBe("inc-past-query-1");
        expect(emitted[1].id).toBe("inc-live-query-1");
        done();
      },
    });
  });

  it("filters out duplicate events from real-time stream that were already delivered during hydration", (done) => {
    const hydratedIncident = {
      ...sampleIncidentDto,
      id: "inc-overlap-1",
      updatedAt: new Date(),
    };
    const mockService = {
      getIncidentsSince: jest.fn().mockResolvedValue({
        items: [hydratedIncident],
        hasMore: false,
        lastEventId: "inc-last-0",
      }),
    };
    // 실시간 스트림에 이미 하이드레이션된 이벤트(inc-overlap-1)와 새로운 이벤트(inc-fresh-2)가 포함된 경우
    const mockEventsService = {
      subscribe: jest
        .fn()
        .mockReturnValue(
          of(
            { id: "inc-overlap-1", data: { duplicated: true } },
            { id: "inc-fresh-2", data: { fresh: true } },
          ),
        ),
    };

    const controller = new IncidentsController(
      mockService as any,
      mockEventsService as any,
    );

    const stream$ = controller.subscribeEvents(mockUser, "inc-last-0");

    const emitted: any[] = [];
    stream$.subscribe({
      next: (event) => emitted.push(event),
      complete: () => {
        expect(emitted.length).toBe(2);
        // 1. 하이드레이션에서 방출된 이벤트
        expect(emitted[0].id).toBe("inc-overlap-1");
        expect(emitted[0].type).toBe("incident:updated");
        // 2. 실시간 스트림에서는 중복된 inc-overlap-1이 필터링되고 inc-fresh-2만 방출됨
        expect(emitted[1].id).toBe("inc-fresh-2");
        done();
      },
    });
  });
});
