import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { GitOpsModule } from "../gitops/gitops.module";
import { ExceptionReconcileSettings } from "./exception-reconcile.settings";
import { ExceptionLifecycleService } from "./exception-lifecycle.service";
import { ExceptionReconcilerService } from "./exception-reconciler.service";

@Module({
  imports: [
    PrismaModule,
    KubernetesModule,
    GitOpsModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    ExceptionReconcileSettings,
    ExceptionLifecycleService,
    ExceptionReconcilerService,
  ],
  exports: [ExceptionLifecycleService],
})
export class ExceptionLifecycleModule {}
