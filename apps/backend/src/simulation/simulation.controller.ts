import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { SimulationService } from "./simulation.service";
import { DeploySimulationDto } from "./dto/deploy-simulation.dto";

/**
 * 정책 시뮬레이션 및 거버넌스 샌드박스 컨트롤러
 *
 * 사용자가 테스트용 파드를 생성하여 Kyverno 어드미션 차단 및
 * 감사 위반 탐지 과정을 체험하고 예외를 신청할 수 있도록 지원합니다.
 */
@ApiTags("simulation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("simulation")
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  /**
   * 사전 정의된 시뮬레이션 시나리오 목록을 조회합니다.
   */
  @Get("scenarios")
  @RequirePermissions("policies.read")
  @ApiOperation({
    summary: "시뮬레이션 시나리오 목록 조회",
    description:
      "사전 정의된 Kyverno 위반 및 준수 시뮬레이션 시나리오 목록을 반환합니다.",
  })
  @ApiResponse({ status: 200, description: "시나리오 목록 반환 성공" })
  getScenarios() {
    return this.simulationService.getScenarios();
  }

  /**
   * 시나리오 또는 커스텀 YAML을 기반으로 시뮬레이션 배포를 시도합니다.
   */
  @Post("deploy")
  @RequirePermissions("policies.read")
  @ApiOperation({
    summary: "정책 시뮬레이션 배포 실행",
    description:
      "지정된 시나리오 파드를 배포하여 Kyverno 어드미션 웹훅의 차단 또는 허용 결과를 실시간 확인합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "시뮬레이션 실행 결과 반환 (차단 또는 허용)",
  })
  deploySimulation(@Body() dto: DeploySimulationDto) {
    return this.simulationService.deploySimulation(dto);
  }

  /**
   * 임의의 쿠버네티스 매니페스트 YAML을 Server-Side Dry-Run 방식으로 사전 검증합니다.
   */
  @Post("dry-run")
  @RequirePermissions("policies.read")
  @ApiOperation({
    summary: "Server-Side Dry-Run 매니페스트 사전 검증",
    description:
      "쿠버네티스 etcd에 영속화하지 않고 dryRun으로 Kyverno 어드미션 웹훅 동작을 검증합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "Dry-run 사전 검증 결과 반환",
  })
  validateDryRun(
    @Body()
    dto: {
      manifestYaml: string;
      namespace?: string;
      clusterId?: string;
    },
  ) {
    return this.simulationService.validateManifestDryRun(
      dto.manifestYaml,
      dto.namespace || "default",
      dto.clusterId || "default",
    );
  }

  /**
   * 현재 클러스터에 배포된 시뮬레이션 리소스 목록을 조회합니다.
   */
  @Get("resources")
  @RequirePermissions("policies.read")
  @ApiOperation({
    summary: "배포된 시뮬레이션 리소스 조회",
    description:
      "현재 클러스터에 남아있는 시뮬레이션 테스트 파드 목록을 조회합니다.",
  })
  getActiveResources(@Query("clusterId") clusterId?: string) {
    return this.simulationService.getActiveSimulationResources(clusterId);
  }

  /**
   * 배포된 모든 시뮬레이션 파드를 일괄 정리합니다.
   */
  @Delete("cleanup")
  @RequirePermissions("policies.read")
  @ApiOperation({
    summary: "시뮬레이션 리소스 일괄 정리",
    description:
      "테스트로 배포된 모든 시뮬레이션 파드를 클러스터에서 삭제합니다.",
  })
  cleanupResources(@Query("clusterId") clusterId?: string) {
    return this.simulationService.cleanupSimulationResources(clusterId);
  }
}
