import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AiAgentModule } from "../ai-agent/ai-agent.module";
import { KubeflowAdapter } from "./notebooks/kubeflow.adapter";
import { NotebooksService } from "./notebooks/notebooks.service";
import { NotebooksController } from "./notebooks/notebooks.controller";
import { NotebookProxyController } from "./notebooks/notebook-proxy.controller";
import { NotebookProxyService } from "./notebooks/notebook-proxy.service";
import { GpuQuotaService } from "./governance/gpu-quota.service";
import { IdleWorkloadMonitorService } from "./governance/idle-workload-monitor.service";
import { MlGovernanceService } from "./governance/ml-governance.service";
import { MlGovernanceController } from "./governance/ml-governance.controller";
import { MlGovernanceEventBus } from "./governance/ml-governance-event-bus.service";

import { KFPAdapter } from "./pipelines/kfp.adapter";
import { PipelinesService } from "./pipelines/pipelines.service";
import { PipelinesController } from "./pipelines/pipelines.controller";
import { KServeAdapter } from "./serving/kserve.adapter";
import { ServingService } from "./serving/serving.service";
import { ServingController } from "./serving/serving.controller";

import { MlopsAssistantController } from "./ai-assistant/mlops-assistant.controller";
import { MlopsAssistantService } from "./ai-assistant/mlops-assistant.service";
import { MlopsIntentParserService } from "./ai-assistant/mlops-intent-parser.service";
import { WorkloadDiagnosticService } from "./ai-assistant/workload-diagnostic.service";

/**
 * MLOps 자율 통합 플랫폼 기능을 제공하는 NestJS 모듈입니다.
 * Kubeflow Notebook Self-Service API, GPU Quota 관리, Idle 모니터링, KFP 파이프라인, KServe 모델 서빙 센터 서비스 및 AI MLOps Copilot 서비스를 등록합니다.
 */
@Module({
  imports: [
    JwtModule.register({}),
    KubernetesModule,
    PrismaModule,
    AiAgentModule,
  ],
  controllers: [
    NotebooksController,
    NotebookProxyController,
    MlGovernanceController,
    PipelinesController,
    ServingController,
    MlopsAssistantController,
  ],
  providers: [
    KubeflowAdapter,
    NotebooksService,
    NotebookProxyService,
    GpuQuotaService,
    IdleWorkloadMonitorService,
    MlGovernanceEventBus,
    MlGovernanceService,
    KFPAdapter,
    PipelinesService,
    KServeAdapter,
    ServingService,
    MlopsAssistantService,
    MlopsIntentParserService,
    WorkloadDiagnosticService,
  ],
  exports: [
    KubeflowAdapter,
    NotebooksService,
    NotebookProxyService,
    GpuQuotaService,
    IdleWorkloadMonitorService,
    MlGovernanceEventBus,
    MlGovernanceService,
    KFPAdapter,
    PipelinesService,
    KServeAdapter,
    ServingService,
    MlopsAssistantService,
    MlopsIntentParserService,
    WorkloadDiagnosticService,
  ],
})
export class MlopsModule {}
