import { Module } from "@nestjs/common";
import { ExceptionLifecycleModule } from "../exception-lifecycle/exception-lifecycle.module";
import { GitOpsModule } from "../gitops/gitops.module";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ExceptionRequestsController } from "./exception-requests.controller";
import { ExceptionRequestsService } from "./exception-requests.service";

@Module({
  imports: [
    PrismaModule,
    KubernetesModule,
    GitOpsModule,
    ExceptionLifecycleModule,
  ],
  controllers: [ExceptionRequestsController],
  providers: [ExceptionRequestsService],
})
export class ExceptionRequestsModule {}
