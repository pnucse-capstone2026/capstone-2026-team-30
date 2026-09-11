import { Module, DynamicModule, Type } from "@nestjs/common";
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
import { GitOpsModule } from "./gitops/gitops.module";
import { MlopsModule } from "./mlops/mlops.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { SimulationModule } from "./simulation/simulation.module";
import { SystemModule } from "./system/system.module";
import { createPinoHttpConfig } from "./logging/pino-http.config";

/**
 * 환경 변수 기반 모듈 활성화 여부를 판별합니다.
 * 값이 지정되지 않은 경우 기본값(true)을 사용하여 하위 호환성을 유지합니다.
 */
const isEnabled = (envVar: string, defaultVal = true): boolean => {
  const val = process.env[envVar];
  return val === undefined ? defaultVal : val.toLowerCase() !== "false";
};

// 플랫폼 배포 환경에 따라 선택적으로 로드할 모듈 목록 구성
export const getOptionalModules = (): (Type<unknown> | DynamicModule)[] => {
  const modules: (Type<unknown> | DynamicModule)[] = [];

  if (isEnabled("MODULE_MLOPS_ENABLED")) {
    modules.push(MlopsModule);
  }
  if (isEnabled("MODULE_SIMULATION_ENABLED")) {
    modules.push(SimulationModule);
  }
  if (isEnabled("MODULE_AI_AGENT_ENABLED")) {
    modules.push(AiAgentModule);
  }
  if (isEnabled("MODULE_GITOPS_ENABLED")) {
    modules.push(GitOpsModule);
  }

  return modules;
};

/**
 * Kyverno Governance Platform 백엔드 루트 모듈
 * 환경 변수에 따라 선택적 기능 모듈(MLOps, AI Copilot 등)을 동적으로 등록합니다.
 */
@Module({
  imports: [
    // 환경 변수 전역 주입 (ConfigService 사용 목적)
    ConfigModule.forRoot({ isGlobal: true }),

    // 핵심 거버넌스 및 필수 인프라 모듈
    PrismaModule,
    AuthModule,
    UsersModule,
    ExceptionRequestsModule,
    PoliciesModule,
    ViolationsModule,
    AuditLogsModule,
    NotificationsModule,
    HealthModule,
    SystemModule,

    // 선택적 확장 모듈 (런타임 환경변수에 따라 동적 로딩)
    ...getOptionalModules(),

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
