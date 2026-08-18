import { Module } from "@nestjs/common";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { KubeflowAdapter } from "./notebooks/kubeflow.adapter";
import { NotebooksService } from "./notebooks/notebooks.service";
import { NotebooksController } from "./notebooks/notebooks.controller";
import { GpuQuotaService } from "./governance/gpu-quota.service";
import { IdleWorkloadMonitorService } from "./governance/idle-workload-monitor.service";
import { MlGovernanceService } from "./governance/ml-governance.service";
import { MlGovernanceController } from "./governance/ml-governance.controller";

/**
 * MLOps 자율 통합 플랫폼 기능을 제공하는 NestJS 모듈입니다.
 * Kubeflow Notebook Self-Service API, GPU Quota 관리, Idle 모니터링 및 MLOps 거버넌스 서비스를 등록합니다.
 */
@Module({
  imports: [KubernetesModule],
  controllers: [NotebooksController, MlGovernanceController],
  providers: [
    KubeflowAdapter,
    NotebooksService,
    GpuQuotaService,
    IdleWorkloadMonitorService,
    MlGovernanceService,
  ],
  exports: [
    KubeflowAdapter,
    NotebooksService,
    GpuQuotaService,
    IdleWorkloadMonitorService,
    MlGovernanceService,
  ],
})
export class MlopsModule {}
