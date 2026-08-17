import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ListViolationsQueryDto } from "./dto/list-violations-query.dto";
import { ViolationDetailDto } from "./dto/violation-detail.dto";
import { ViolationSummaryDto } from "./dto/violation-summary.dto";
import { ViolationsService } from "./violations.service";

/**
 * Kyverno 정책 위반 실시간 조회 API 컨트롤러
 */
@ApiTags("violations")
@ApiBearerAuth()
@Controller("violations")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ViolationsController {
  constructor(private readonly service: ViolationsService) {}

  /**
   * 사용자에게 배정된 클러스터에서 실시간 정책 위반 내역 목록을 조회합니다.
   *
   * @param user 인증된 요청자 정보
   * @param query 필터 및 검색 옵션
   * @returns 위반 요약 정보 배열
   */
  @Get()
  @RequirePermissions("violations.read")
  @ApiOperation({ summary: "실시간 정책 위반(PolicyReport) 목록 조회" })
  @ApiResponse({
    status: 200,
    description: "위반 목록 조회 성공",
    type: [ViolationSummaryDto],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListViolationsQueryDto,
  ): Promise<ViolationSummaryDto[]> {
    return this.service.list(user, query);
  }

  /**
   * 특정 정책 위반의 상세 정보 및 원본 K8s PolicyReport 결과를 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param id 위반 식별자 (<clusterId>:<reportName>:<resultIndex>)
   * @param user 인증된 요청자 정보
   * @returns 정책 위반 상세 DTO
   */
  @Get(":clusterId/:id")
  @RequirePermissions("violations.read")
  @ApiOperation({ summary: "특정 정책 위반 상세 조회" })
  @ApiResponse({
    status: 200,
    description: "위반 상세 조회 성공",
    type: ViolationDetailDto,
  })
  getDetail(
    @Param("clusterId") clusterId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ViolationDetailDto> {
    return this.service.getDetail(clusterId, id, user);
  }
}
