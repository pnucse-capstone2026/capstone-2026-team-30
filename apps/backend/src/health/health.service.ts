import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface HealthCheckResult {
  status: "ok" | "error";
  database: "connected" | "disconnected";
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
}

/**
 * 플랫폼 시스템 헬스 체크 및 인프라 종속성(PostgreSQL) 연결 상태를 진단하는 서비스
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prismaService: PrismaService) {}

  /**
   * 백엔드 애플리케이션 및 연동 데이터베이스 상태를 점검합니다.
   *
   * @returns 시스템 상태, 데이터베이스 연결 상태, 가동 시간 및 환경 정보
   */
  async checkHealth(): Promise<HealthCheckResult> {
    let databaseStatus: "connected" | "disconnected" = "disconnected";

    try {
      // PostgreSQL 활성 연결 확인 쿼리 실행
      await this.prismaService.$queryRaw`SELECT 1`;
      databaseStatus = "connected";
    } catch (error) {
      this.logger.error(
        `Database health check query failed: ${(error as Error).message}`,
      );
    }

    return {
      status: databaseStatus === "connected" ? "ok" : "error",
      database: databaseStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV ?? "development",
    };
  }
}
