import { Module } from "@nestjs/common";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { KubeflowAdapter } from "./notebooks/kubeflow.adapter";
import { NotebooksService } from "./notebooks/notebooks.service";
import { NotebooksController } from "./notebooks/notebooks.controller";
import { GpuQuotaService } from "./governance/gpu-quota.service";
import { IdleWorkloadMonitorService } from "./governance/idle-workload-monitor.service";
import { MlGovernanceService } from "./governance/ml-governance.service";
import { MlGovernanceController } from "./governance/ml-governance.controller";

import { KFPAdapter } from "./pipelines/kfp.adapter";
import { PipelinesService } from "./pipelines/pipelines.service";
import { PipelinesController } from "./pipelines/pipelines.controller";
import { KServeAdapter } from "./serving/kserve.adapter";
import { ServingService } from "./serving/serving.service";
import { ServingController } from "./serving/serving.controller";

/**
 * MLOps 자율 통합 플랫폼 기능을 제공하는 NestJS 모듈입니다.
 * Kubeflow Notebook Self-Service API, GPU Quota 관리, Idle 모니터링, KFP 파이프라인 및 KServe 모델 서빙 센터 서비스를 등록합니다.
 */
@Module({
  imports: [KubernetesModule, PrismaModule],
  controllers: [
    NotebooksController,
    MlGovernanceController,
    PipelinesController,
    ServingController,
  ],
  providers: [
    KubeflowAdapter,
    NotebooksService,
    GpuQuotaService,
    IdleWorkloadMonitorService,
    MlGovernanceService,
    KFPAdapter,
    PipelinesService,
    KServeAdapter,
    ServingService,
  ],
  exports: [
    KubeflowAdapter,
    NotebooksService,
    GpuQuotaService,
    IdleWorkloadMonitorService,
    MlGovernanceService,
    KFPAdapter,
    PipelinesService,
    KServeAdapter,
    ServingService,
  ],
})
export class MlopsModule {}
