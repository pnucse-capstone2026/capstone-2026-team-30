import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { HealthService } from "./health.service";

/**
 * 플랫폼 시스템 헬스 체크 및 K8s Liveness/Readiness Probe 응답 컨트롤러
 */
@ApiTags("health")
@Controller(["api/health", "health"])
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * 애플리케이션 및 의존 데이터베이스의 종합 헬스 상태를 반환합니다.
   *
   * @param res Express Response 객체 (상태 코드 동적 분기용)
   * @returns 200 OK (정상) 또는 503 Service Unavailable (장애)
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "플랫폼 상태 및 DB 헬스 체크",
    description:
      "백엔드 프로세스 가동 상태와 PostgreSQL 데이터베이스 연결성을 확인하여 Kubernetes Probe 및 모니터링 시스템에 응답합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "플랫폼 및 데이터베이스 정상 작동 중",
  })
  @ApiResponse({
    status: 503,
    description: "데이터베이스 연결 끊김 또는 내부 장애 발생",
  })
  async getHealth(@Res() res: Response): Promise<void> {
    const result = await this.healthService.checkHealth();

    if (result.status === "ok") {
      res.status(HttpStatus.OK).json(result);
    } else {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json(result);
    }
  }
}
