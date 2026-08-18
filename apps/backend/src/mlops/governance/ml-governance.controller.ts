import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../../auth/auth.types";
import { BusinessException } from "../../common/errors/business.exception";
import { MLOPS_ERROR } from "../mlops.errors";
import { MlGovernanceService } from "./ml-governance.service";
import { GpuQuotaService } from "./gpu-quota.service";
import {
  GovernanceSettings,
  IdleWorkloadMonitorService,
} from "./idle-workload-monitor.service";
import { IsBoolean, IsNumber, IsOptional, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateGovernanceSettingsDto {
  @ApiPropertyOptional({
    description: "유휴 판단 임계 시간 (시간)",
    example: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  idleThresholdHours?: number;

  @ApiPropertyOptional({
    description: "자동 중지 기능 활성화 여부",
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  autoStopEnabled?: boolean;

  @ApiPropertyOptional({ description: "사용자 알림 발송 여부", example: true })
  @IsOptional()
  @IsBoolean()
  notifyUser?: boolean;
}

/**
 * MLOps 거버넌스, FinOps 클라우드 비용 모니터링, GPU 쿼터 현황 및 유휴 자동 종료 설정을 제공하는 NestJS REST 컨트롤러입니다.
 */
@ApiTags("MLOps Governance")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("mlops/governance")
export class MlGovernanceController {
  constructor(
    private readonly mlGovernanceService: MlGovernanceService,
    private readonly gpuQuotaService: GpuQuotaService,
    private readonly idleMonitorService: IdleWorkloadMonitorService,
  ) {}

  /**
   * MLOps 리소스 거버넌스 및 FinOps 비용 절감 지표 개요를 조회합니다.
   */
  @Get("overview")
  @RequirePermissions("mlops.governance")
  @ApiOperation({
    summary: "MLOps 거버넌스 개요 및 FinOps 지표 조회",
    description:
      "GPU 쿼터 사용률, Active/Idle 노트북 수량, 자동 중지로 절감된 추정 비용 지표를 반환합니다.",
  })
  async getOverview(
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "default",
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.validateClusterAccess(user, clusterId);
    return this.mlGovernanceService.getGovernanceOverview(clusterId, namespace);
  }

  /**
   * 클러스터 및 네임스페이스 레벨 GPU 쿼터 현황을 조회합니다.
   */
  @Get("gpu-quotas")
  @RequirePermissions("mlops.governance")
  @ApiOperation({
    summary: "GPU 쿼터 현황 조회",
    description:
      "네임스페이스 단위 GPU 요청 수량, 한도 및 잔여 수량을 반환합니다.",
  })
  async getGpuQuotas(
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "default",
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.validateClusterAccess(user, clusterId);
    return this.gpuQuotaService.getGpuQuotaStatus(clusterId, namespace);
  }

  /**
   * MLOps 관련 Kyverno 정책 위반 내역 목록을 조회합니다.
   */
  @Get("violations")
  @RequirePermissions("mlops.governance")
  @ApiOperation({
    summary: "MLOps Kyverno 정책 위반 내역 조회",
    description:
      "GPU 제한, Spot 인스턴스 미적용, 승인되지 않은 이미지 배포 등 ML 관련 위반 보고서를 반환합니다.",
  })
  async getViolations(
    @Query("clusterId") clusterId?: string,
    @Query("namespace") namespace?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (user && clusterId) {
      this.validateClusterAccess(user, clusterId);
    }
    return this.mlGovernanceService.getMlPolicyViolations(clusterId, namespace);
  }

  /**
   * 유휴 워크로드 자동 중지 설정을 조회합니다.
   */
  @Get("settings")
  @RequirePermissions("mlops.governance")
  @ApiOperation({
    summary: "유휴 노트북 자동 중지 설정 조회",
    description:
      "현재 설정된 유휴 임계 시간, 자동 중지 활성화 여부를 조회합니다.",
  })
  getSettings(): GovernanceSettings {
    return this.idleMonitorService.getSettings();
  }

  /**
   * 유휴 워크로드 자동 중지 설정을 변경합니다.
   */
  @Patch("settings")
  @RequirePermissions("mlops.governance")
  @ApiOperation({
    summary: "유휴 노트북 자동 중지 설정 변경",
    description: "유휴 임계시간 및 자동 중지 활성화 설정을 업데이트합니다.",
  })
  updateSettings(@Body() dto: UpdateGovernanceSettingsDto): GovernanceSettings {
    try {
      return this.idleMonitorService.updateSettings(dto);
    } catch {
      throw new BusinessException(MLOPS_ERROR.GOVERNANCE_SETTINGS_INVALID);
    }
  }

  /**
   * 유휴 워크로드 자동 종료 검사를 수동으로 즉시 트리거합니다.
   */
  @Post("idle-monitor/trigger")
  @RequirePermissions("mlops.governance")
  @ApiOperation({
    summary: "유휴 노트북 감시 수동 트리거",
    description:
      "지정된 클러스터의 유휴 노트북 검사를 즉시 수행하고 수동 종료 결과를 반환합니다.",
  })
  async triggerIdleMonitor(
    @Query("clusterId") clusterId?: string,
    @Query("namespace") namespace: string = "default",
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (user && clusterId) {
      this.validateClusterAccess(user, clusterId);
    }
    try {
      return await this.idleMonitorService.checkAndShutdownIdleNotebooks(
        clusterId,
        namespace,
      );
    } catch {
      throw new BusinessException(MLOPS_ERROR.IDLE_MONITOR_FAILED);
    }
  }

  private validateClusterAccess(
    user: AuthenticatedUser,
    clusterId: string,
  ): void {
    if (user.role !== "ADMIN" && !user.clusterIds.includes(clusterId)) {
      throw new BusinessException(MLOPS_ERROR.CLUSTER_ACCESS_DENIED);
    }
  }
}
