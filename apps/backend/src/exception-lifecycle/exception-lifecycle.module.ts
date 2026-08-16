import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ExceptionLifecycleService } from "./exception-lifecycle.service";
import { ExceptionReconcilerService } from "./exception-reconciler.service";

@Module({
  imports: [PrismaModule, KubernetesModule, ScheduleModule.forRoot()],
  providers: [ExceptionLifecycleService, ExceptionReconcilerService],
  exports: [ExceptionLifecycleService],
})
export class ExceptionLifecycleModule {}
