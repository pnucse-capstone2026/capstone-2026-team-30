import { Module } from "@nestjs/common";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PoliciesController } from "./policies.controller";
import { PoliciesService } from "./policies.service";

/**
 * Kyverno 정책 실시간 조회 및 분석 모듈
 */
@Module({
  imports: [KubernetesModule, PrismaModule],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
