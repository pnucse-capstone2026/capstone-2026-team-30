import { Controller, Get, HttpStatus } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SystemService } from "./system.service";
import { SystemModulesResponseDto } from "./system.types";

/**
 * 플랫폼 시스템 상태 및 모듈 메타데이터를 제공하는 컨트롤러
 */
@ApiTags("System")
@Controller("system")
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  /**
   * 플랫폼 모듈 활성화 현황 및 세부 메타데이터를 조회합니다.
   *
   * @returns 모듈 활성화 매핑 객체
   */
  @Get("modules")
  @ApiOperation({
    summary: "플랫폼 모듈 활성화 목록 조회",
    description:
      "현재 배포 환경에서 활성화된 기능 모듈(Core, MLOps, AI Copilot, Simulation 등)의 메타데이터를 반환합니다.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "모듈 활성화 메타데이터 반환 성공",
    type: SystemModulesResponseDto,
  })
  getModules(): SystemModulesResponseDto {
    return this.systemService.getModules();
  }
}
