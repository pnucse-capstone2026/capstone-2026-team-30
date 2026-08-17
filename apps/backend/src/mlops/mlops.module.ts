import { Module } from "@nestjs/common";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { KubeflowAdapter } from "./notebooks/kubeflow.adapter";
import { NotebooksService } from "./notebooks/notebooks.service";
import { NotebooksController } from "./notebooks/notebooks.controller";

/**
 * MLOps 자율 통합 플랫폼 기능을 제공하는 NestJS 모듈입니다.
 * Kubeflow Notebook Self-Service API 및 어댑터를 등록합니다.
 */
@Module({
  imports: [KubernetesModule],
  controllers: [NotebooksController],
  providers: [KubeflowAdapter, NotebooksService],
  exports: [KubeflowAdapter, NotebooksService],
})
export class MlopsModule {}
