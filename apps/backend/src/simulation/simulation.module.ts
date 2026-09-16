import { Module } from "@nestjs/common";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { InMemoryFastFailEngine } from "./fast-fail/in-memory-fast-fail.engine";
import { SimulationController } from "./simulation.controller";
import { SimulationService } from "./simulation.service";

/**
 * 정책 시뮬레이션 및 거버넌스 샌드박스 모듈
 */
@Module({
  imports: [KubernetesModule, PrismaModule],
  controllers: [SimulationController],
  providers: [SimulationService, InMemoryFastFailEngine],
  exports: [SimulationService, InMemoryFastFailEngine],
})
export class SimulationModule {}
