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
import { ListPoliciesQueryDto } from "./dto/list-policies-query.dto";
import { PolicyDetailDto } from "./dto/policy-detail.dto";
import { PolicySummaryDto } from "./dto/policy-summary.dto";
import { PoliciesService } from "./policies.service";

/**
 * Kyverno 정책 실시간 조회 및 분석 API 컨트롤러
 */
@ApiTags("policies")
@ApiBearerAuth()
@Controller("policies")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PoliciesController {
  constructor(private readonly service: PoliciesService) {}

  /**
   * 사용자에게 배정된 클러스터에서 실시간 Kyverno 정책 목록을 조회합니다.
   *
   * @param user 인증된 요청자 정보
   * @param query 필터 및 검색 옵션
   * @returns 정책 요약 정보 배열
   */
  @Get()
  @RequirePermissions("policies.read")
  @ApiOperation({ summary: "Kyverno 정책 목록 실시간 조회" })
  @ApiResponse({
    status: 200,
    description: "정책 목록 조회 성공",
    type: [PolicySummaryDto],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPoliciesQueryDto,
  ): Promise<PolicySummaryDto[]> {
    return this.service.list(user, query);
  }

  /**
   * 특정 정책의 상세 명세, 규칙(Rules), 모드, autogen 규칙을 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param name 정책 이름
   * @param namespace 네임스페이스 (Namespaced Policy인 경우 선택)
   * @param user 인증된 요청자 정보
   * @returns 정책 상세 명세 DTO
   */
  @Get(":clusterId/:name")
  @RequirePermissions("policies.read")
  @ApiOperation({ summary: "특정 Kyverno 정책 상세 조회" })
  @ApiResponse({
    status: 200,
    description: "정책 상세 조회 성공",
    type: PolicyDetailDto,
  })
  getDetail(
    @Param("clusterId") clusterId: string,
    @Param("name") name: string,
    @Query("namespace") namespace: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PolicyDetailDto> {
    return this.service.getDetail(clusterId, name, user, namespace);
  }
}
