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

  it("hydrates missed events when last-event-id header is provided", (done) => {
    const pastIncident = {
      ...sampleIncidentDto,
      id: "inc-past-1",
      updatedAt: new Date(),
    };
    const mockService = {
      getIncidentsSince: jest.fn().mockResolvedValue([pastIncident]),
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
});
