import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { BusinessExceptionFilter } from "./common/errors/business-exception.filter";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { ExceptionRequestsModule } from "./exception-requests/exception-requests.module";
import { PoliciesModule } from "./policies/policies.module";
import { ViolationsModule } from "./violations/violations.module";
import { AuditLogsModule } from "./audit-logs/audit-logs.module";
import { AiAgentModule } from "./ai-agent/ai-agent.module";
import { HealthModule } from "./health/health.module";
import { createPinoHttpConfig } from "./logging/pino-http.config";

/**
 * Kyverno Governance Platform 백엔드 루트 모듈
 */
@Module({
  imports: [
    // 환경 변수 전역 주입 (ConfigService 사용 목적)
    ConfigModule.forRoot({ isGlobal: true }),

    // 핵심 도메인 및 인프라 모듈
    PrismaModule,
    AuthModule,
    UsersModule,
    ExceptionRequestsModule,
    PoliciesModule,
    ViolationsModule,
    AuditLogsModule,
    AiAgentModule,
    HealthModule,

    // 구조화된 Pino HTTP 로거 설정
    LoggerModule.forRoot({
      pinoHttp: createPinoHttpConfig(),
    }),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: BusinessExceptionFilter,
    },
  ],
})
export class AppModule {}
