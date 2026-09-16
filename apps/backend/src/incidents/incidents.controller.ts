import {
  Body,
  Controller,
  Get,
  Headers,
  MessageEvent,
  Param,
  Patch,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { concat, from, Observable } from "rxjs";
import { filter, mergeMap } from "rxjs/operators";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { IgnoreIncidentDto } from "./dto/ignore-incident.dto";
import { ListIncidentsQueryDto } from "./dto/incident-query.dto";
import {
  DeploymentIncidentDto,
  PaginatedIncidentsResponseDto,
} from "./dto/incident-response.dto";
import { IncidentsEventsService } from "./incidents-events.service";
import { IncidentsService } from "./incidents.service";

/**
 * Closed-Loop Admission Block 배포 차단 인시던트 REST API 컨트롤러
 *
 * Kyverno Admission Webhook 차단으로 인한 배포 실패 인시던트 조회, 무시 처리 및 실시간 SSE 스트림을 제공합니다.
 */
@ApiTags("Incidents")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("api/v1/incidents")
export class IncidentsController {
  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly incidentsEventsService: IncidentsEventsService,
  ) {}

  /**
   * 실시간 인시던트 변경 SSE(Server-Sent Events) 스트림을 구독합니다.
   * 사용자 권한이 있는 클러스터의 생성/갱신 이벤트를 실시간 수신하며,
   * W3C Last-Event-ID 헤더가 제공될 경우 단절 시점 이후 누락된 변경분을 차분 하이드레이션(Delta Hydration)합니다.
   */
  @Sse("events")
  @RequirePermissions("incidents.read")
  @ApiOperation({
    summary: "실시간 배포 차단 인시던트 SSE 스트림 구독",
    description:
      "사용자가 접근 가능한 클러스터의 인시던트 생성 및 상태 변경 이벤트를 실시간으로 스트리밍합니다. Last-Event-ID 헤더 및 lastEventId 쿼리 파라미터를 통한 일시 단절 차분 동기화를 지원합니다.",
  })
  @ApiHeader({
    name: "last-event-id",
    required: false,
    description:
      "W3C 표준 재연결 시점 이벤트 식별자 (인시던트 ID 또는 타임스탬프)",
  })
  @ApiQuery({
    name: "lastEventId",
    required: false,
    description:
      "브라우저 EventSource 재연결을 위한 쿼리 파라미터 이벤트 식별자",
  })
  subscribeEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("last-event-id") headerLastEventId?: string,
    @Query("lastEventId") queryLastEventId?: string,
  ): Observable<MessageEvent> {
    const lastEventId = (headerLastEventId || queryLastEventId)?.trim();

    const realTime$ = this.incidentsEventsService.subscribe(
      user.clusterIds || [],
      user.role === "ADMIN",
    );

    if (!lastEventId) {
      return realTime$;
    }

    const deliveredIds = new Set<string>();

    // W3C Last-Event-ID 기준 과거 누락 변경분 차분 하이드레이션 스트림
    const hydration$ = from(
      this.incidentsService.getIncidentsSince(user, lastEventId),
    ).pipe(
      mergeMap((deltaResult) => {
        const events: MessageEvent[] = deltaResult.items.map((incident) => {
          deliveredIds.add(incident.id);
          return {
            id: incident.id,
            type: "incident:updated",
            data: {
              eventType: "incident:updated",
              incident,
              timestamp:
                incident.updatedAt instanceof Date
                  ? incident.updatedAt.toISOString()
                  : String(incident.updatedAt),
            },
          } as MessageEvent;
        });

        // 차분 하이드레이션 상한선(100건) 도달 시 전체 재동기화 제어 이벤트 발행
        if (deltaResult.hasMore) {
          events.push({
            type: "resync-required",
            data: {
              reason: "DELTA_BUFFER_OVERFLOW",
              message:
                "Disconnected duration exceeded delta buffer. Full re-synchronization required.",
              count: deltaResult.items.length,
            },
          } as MessageEvent);
        }

        return from(events);
      }),
    );

    const filteredRealTime$ = realTime$.pipe(
      filter((event: MessageEvent) => !event.id || !deliveredIds.has(event.id)),
    );

    return concat(hydration$, filteredRealTime$);
  }

  /**
   * 배포 차단 인시던트 목록을 페이징 및 필터 조건으로 조회합니다.
   */
  @Get()
  @RequirePermissions("incidents.read")
  @ApiOperation({
    summary: "배포 차단 인시던트 목록 조회",
    description:
      "클러스터, 네임스페이스, 상태, GitOps 앱 이름 등의 조건으로 인시던트 목록을 페이징 조회합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "인시던트 목록 조회 성공",
    type: PaginatedIncidentsResponseDto,
  })
  async getIncidents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListIncidentsQueryDto,
  ): Promise<PaginatedIncidentsResponseDto> {
    return this.incidentsService.getIncidents(user, query);
  }

  /**
   * 특정 배포 차단 인시던트의 상세 정보를 조회합니다.
   */
  @Get(":id")
  @RequirePermissions("incidents.read")
  @ApiOperation({
    summary: "배포 차단 인시던트 단일 상세 조회",
    description:
      "지정된 인시던트 식별자(ID)의 상세 정보 및 차단 사유를 조회합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "인시던트 상세 조회 성공",
    type: DeploymentIncidentDto,
  })
  async getIncidentById(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<DeploymentIncidentDto> {
    return this.incidentsService.getIncidentById(user, id);
  }

  /**
   * 특정 인시던트를 수동 무시(IGNORED) 처리합니다.
   */
  @Patch(":id/ignore")
  @RequirePermissions("incidents.manage")
  @ApiOperation({
    summary: "배포 차단 인시던트 수동 무시 처리",
    description:
      "관리자 또는 운영자가 해당 인시던트를 확인하고 무시(IGNORED) 상태로 전이합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "인시던트 무시 처리 성공",
    type: DeploymentIncidentDto,
  })
  async ignoreIncident(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: IgnoreIncidentDto,
  ): Promise<DeploymentIncidentDto> {
    return this.incidentsService.ignoreIncident(user, id, dto);
  }
}
