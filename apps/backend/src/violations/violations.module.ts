import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ViolationsController } from "./violations.controller";
import { ViolationsService } from "./violations.service";

/**
 * Kyverno 정책 위반(PolicyReport) 수집, DB 동기화 및 조회 모듈
 */
@Module({
  imports: [KubernetesModule, PrismaModule, ScheduleModule.forRoot()],
  controllers: [ViolationsController],
  providers: [ViolationsService],
  exports: [ViolationsService],
})
export class ViolationsModule {}
