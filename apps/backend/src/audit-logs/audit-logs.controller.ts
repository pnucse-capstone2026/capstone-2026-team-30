import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { AuditLogsService } from "./audit-logs.service";
import { AuditLogItemDto } from "./dto/audit-log-item.dto";
import { ListAuditLogsQueryDto } from "./dto/list-audit-logs-query.dto";
import { PaginatedAuditLogsDto } from "./dto/paginated-audit-logs.dto";

/**
 * 플랫폼 감사 로그 조회 API 컨트롤러
 */
@ApiTags("audit-logs")
@ApiBearerAuth()
@Controller("audit-logs")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditLogsController {
  constructor(private readonly service: AuditLogsService) {}

  /**
   * 필터 및 페이징 조건에 따라 감사 로그 목록을 조회합니다.
   *
   * @param query 감사 로그 페이징 및 필터 DTO
   * @returns 페이징 처리된 감사 로그 목록
   */
  @Get()
  @RequirePermissions("audit_logs.read")
  @ApiOperation({ summary: "감사 로그 목록 페이징 조회" })
  @ApiResponse({
    status: 200,
    description: "감사 로그 목록 조회 성공",
    type: PaginatedAuditLogsDto,
  })
  list(@Query() query: ListAuditLogsQueryDto): Promise<PaginatedAuditLogsDto> {
    return this.service.list(query);
  }

  /**
   * 특정 감사 로그 항목 단건을 상세 조회합니다.
   *
   * @param id 감사 로그 식별자 (UUID)
   * @returns 감사 로그 항목 DTO
   */
  @Get(":id")
  @RequirePermissions("audit_logs.read")
  @ApiOperation({ summary: "특정 감사 로그 상세 조회" })
  @ApiResponse({
    status: 200,
    description: "감사 로그 상세 조회 성공",
    type: AuditLogItemDto,
  })
  get(@Param("id") id: string): Promise<AuditLogItemDto> {
    return this.service.get(id);
  }
}
