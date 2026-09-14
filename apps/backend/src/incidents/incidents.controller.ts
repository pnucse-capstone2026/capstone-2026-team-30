import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Patch,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Observable } from "rxjs";
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
   * 사용자 권한이 있는 클러스터의 생성/갱신 이벤트만 실시간 수신합니다.
   */
  @Sse("events")
  @RequirePermissions("incidents.read")
  @ApiOperation({
    summary: "실시간 배포 차단 인시던트 SSE 스트림 구독",
    description:
      "사용자가 접근 가능한 클러스터의 인시던트 생성 및 상태 변경 이벤트를 실시간으로 스트리밍합니다.",
  })
  subscribeEvents(
    @CurrentUser() user: AuthenticatedUser,
  ): Observable<MessageEvent> {
    return this.incidentsEventsService.subscribe(
      user.clusterIds || [],
      user.role === "ADMIN",
    );
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
