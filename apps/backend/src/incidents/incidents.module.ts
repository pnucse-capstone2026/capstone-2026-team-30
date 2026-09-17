import { Module, forwardRef } from "@nestjs/common";
import { GitOpsModule } from "../gitops/gitops.module";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";
import { IncidentsController } from "./incidents.controller";
import { IncidentsEventsService } from "./incidents-events.service";
import { IncidentsService } from "./incidents.service";

/**
 * Closed-Loop Admission Block 배포 차단 인시던트 모듈
 */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    forwardRef(() => GitOpsModule),
    forwardRef(() => KubernetesModule),
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentsEventsService],
  exports: [IncidentsService, IncidentsEventsService],
})
export class IncidentsModule {}
