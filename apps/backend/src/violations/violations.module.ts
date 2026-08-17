import { Module } from "@nestjs/common";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { ViolationsController } from "./violations.controller";
import { ViolationsService } from "./violations.service";

/**
 * Kyverno 정책 위반(PolicyReport) 수집 및 조회 모듈
 */
@Module({
  imports: [KubernetesModule],
  controllers: [ViolationsController],
  providers: [ViolationsService],
  exports: [ViolationsService],
})
export class ViolationsModule {}
