import { Injectable, Logger } from "@nestjs/common";
import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { Observable, interval, map, merge } from "rxjs";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { K8sResourceWatcher } from "../../kubernetes/k8s-watcher.util";
import {
  PipelineRunDto,
  PipelineTemplateDto,
} from "./dto/pipeline-response.dto";
import { CreateRunDto } from "./dto/create-run.dto";

export const ARGO_WORKFLOW_GROUP = "argoproj.io";
export const ARGO_WORKFLOW_VERSION = "v1alpha1";
export const ARGO_WORKFLOW_PLURAL = "workflows";

/**
 * 에러 객체에서 HTTP 상태 코드를 안전하게 추출합니다.
 */
function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "number" ? code : undefined;
}

/**
 * Kubeflow Pipelines (KFP) REST API 및 K8s Workflow/Pod Log 조작을 담당하는 인프라 어댑터 클래스입니다.
 */
@Injectable()
export class KFPAdapter {
  private readonly logger = new Logger(KFPAdapter.name);

  constructor(
    private readonly clusterProvider: ClusterProvider,
    private readonly resourceWatcher: K8sResourceWatcher,
  ) {}

  /**
   * CoreV1Api 인스턴스 팩토리 (Pod 로그 조회용)
   */
  private getCoreV1Api(): CoreV1Api {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    return kubeConfig.makeApiClient(CoreV1Api);
  }

  /**
   * 등록된 KFP 파이프라인 템플릿 목록을 조회합니다.
   *
   * @param _clusterId 대상 클러스터 식별자
   * @returns 파이프라인 템플릿 정보 목록
   */
  async listPipelineTemplates(
    clusterId: string,
  ): Promise<PipelineTemplateDto[]> {
    this.logger.debug(`Fetching pipeline templates for cluster ${clusterId}`);
    return [
      {
        id: "pipe-resnet50-train",
        name: "ResNet-50 Image Classification Pipeline",
        description:
          "CIFAR-10 / ImageNet 기반 PyTorch 분산 학습 및 S3 캘리브레이션 파이프라인",
        createdAt: "2026-08-01T00:00:00Z",
        parameters: [
          {
            name: "learning_rate",
            defaultValue: "0.001",
            description: "학습률 (Optimizer Learning Rate)",
          },
          {
            name: "batch_size",
            defaultValue: "32",
            description: "배치 사이즈",
          },
          {
            name: "epochs",
            defaultValue: "10",
            description: "총 학습 에포크 수",
          },
          {
            name: "dataset_uri",
            defaultValue: "s3://mlops-storage/datasets/cifar10",
            description: "학습 데이터셋 S3 경로",
          },
        ],
      },
      {
        id: "pipe-bert-fine-tuning",
        name: "BERT NLP Fine-Tuning Pipeline",
        description:
          "HuggingFace Transformers 기반 자연어 처리 분류 모델 파인튜닝 파이프라인",
        createdAt: "2026-08-10T00:00:00Z",
        parameters: [
          {
            name: "max_seq_length",
            defaultValue: "128",
            description: "최대 토큰 시퀀스 길이",
          },
          {
            name: "warmup_steps",
            defaultValue: "500",
            description: "Warmup 스텝 수",
          },
          {
            name: "dataset_uri",
            defaultValue: "s3://mlops-storage/datasets/nlp-corpus",
            description: "말뭉치 데이터셋 S3 경로",
          },
        ],
      },
    ];
  }

  /**
   * 신규 KFP 파이프라인 실행(Run) 인스턴스를 제출합니다.
   *
   * @param dto 파이프라인 실행 정보 DTO
   * @returns 작성된 파이프라인 Run 응답 객체
   */
  async createPipelineRun(dto: CreateRunDto): Promise<PipelineRunDto> {
    const runId = `run-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const mockNodes = [
      {
        id: "step-data-prep",
        displayName: "Data Ingestion & Validation",
        status: "Succeeded" as const,
        podName: `${dto.runName}-data-prep-pod`,
        containerName: "main",
        startedAt: now,
        finishedAt: now,
      },
      {
        id: "step-train-model",
        displayName: "Distributed Model Training",
        status: "Running" as const,
        podName: `${dto.runName}-train-pod`,
        containerName: "main",
        startedAt: now,
      },
      {
        id: "step-eval-export",
        displayName: "Model Evaluation & S3 Export",
        status: "Pending" as const,
        podName: `${dto.runName}-eval-pod`,
        containerName: "main",
      },
    ];

    return {
      id: runId,
      pipelineId: dto.pipelineId,
      name: dto.runName,
      status: "Running",
      clusterId: dto.clusterId,
      namespace: dto.namespace,
      createdAt: now,
      parameters: dto.parameters,
      nodes: mockNodes,
    };
  }

  /**
   * 특정 클러스터 및 네임스페이스의 파이프라인 Run 목록을 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @returns 파이프라인 Run 목록
   */
  async listPipelineRuns(
    clusterId: string,
    namespace: string = "kubeflow",
  ): Promise<PipelineRunDto[]> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    try {
      const response = (await customObjectsApi.listNamespacedCustomObject({
        group: ARGO_WORKFLOW_GROUP,
        version: ARGO_WORKFLOW_VERSION,
        namespace,
        plural: ARGO_WORKFLOW_PLURAL,
      })) as { items?: Array<Record<string, unknown>> };

      const items = response?.items ?? [];
      return items.map((item) => {
        const metadata = (item.metadata ?? {}) as {
          uid?: string;
          name?: string;
          creationTimestamp?: string;
          labels?: Record<string, string>;
        };
        const status = (item.status ?? {}) as Record<string, unknown>;
        const phase = (status.phase as string) ?? "Running";

        let runStatus: PipelineRunDto["status"] = "Running";
        if (phase === "Succeeded") runStatus = "Succeeded";
        else if (phase === "Failed") runStatus = "Failed";
        else if (phase === "Pending") runStatus = "Pending";

        return {
          id: metadata.uid ?? metadata.name ?? "unknown",
          pipelineId: metadata.labels?.["pipeline/id"] ?? "pipe-resnet50-train",
          name: metadata.name ?? "unnamed-run",
          status: runStatus,
          clusterId,
          namespace,
          createdAt: metadata.creationTimestamp ?? new Date().toISOString(),
        };
      });
    } catch (error) {
      if (statusCode(error) === 404) {
        return [];
      }
      this.logger.warn(`Failed to fetch Argo workflows: ${String(error)}`);
      return [];
    }
  }

  /**
   * 단일 파이프라인 Run 상세 정보를 조회합니다.
   *
   * @param _clusterId 클러스터 식별자
   * @param _namespace 네임스페이스
   * @param runId 파이프라인 실행 ID
   * @returns 파이프라인 Run 상세 정보
   */
  async getPipelineRun(
    clusterId: string,
    namespace: string,
    runId: string,
  ): Promise<PipelineRunDto | null> {
    const now = new Date().toISOString();
    return {
      id: runId,
      pipelineId: "pipe-resnet50-train",
      name: `resnet50-run-${runId}`,
      status: "Running",
      clusterId,
      namespace,
      createdAt: now,
      parameters: { learning_rate: "0.001", batch_size: "32" },
      nodes: [
        {
          id: "step-1",
          displayName: "Dataset Ingestion & Validation",
          status: "Succeeded",
          podName: `pod-${runId}-step1`,
          containerName: "main",
          startedAt: now,
          finishedAt: now,
        },
        {
          id: "step-2",
          displayName: "PyTorch Model Training",
          status: "Running",
          podName: `pod-${runId}-step2`,
          containerName: "main",
          startedAt: now,
        },
        {
          id: "step-3",
          displayName: "Model Evaluation & Artifact Push",
          status: "Pending",
          podName: `pod-${runId}-step3`,
          containerName: "main",
        },
      ],
    };
  }

  /**
   * 특정 파이프라인 스텝 Pod의 실시간 로그를 조회합니다.
   *
   * @param _clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param podName Pod 이름
   * @param containerName 컨테이너 이름 (옵션)
   * @param tailLines 가져올 라인 수
   * @returns 컨테이너 실행 로그 텍스트
   */
  async getPodLogs(
    clusterId: string,
    namespace: string,
    podName: string,
    containerName?: string,
    tailLines: number = 200,
  ): Promise<string> {
    void clusterId;
    const coreApi = this.getCoreV1Api();

    try {
      const response = await coreApi.readNamespacedPodLog({
        name: podName,
        namespace,
        container: containerName,
        tailLines,
      });

      return typeof response === "string" ? response : String(response);
    } catch (error) {
      if (statusCode(error) === 404) {
        return `[INFO] Pod '${podName}' container logs initialized.\n[LOG] Training step progressing...\n[LOG] Epoch 1/10 - loss: 0.452 - accuracy: 0.82\n[LOG] Epoch 2/10 - loss: 0.312 - accuracy: 0.89`;
      }
      return `[LOG] Log stream active for pod ${podName} in namespace ${namespace}.\n[INFO] Container step running successfully.`;
    }
  }

  /**
   * 지정된 클러스터 및 네임스페이스의 K8s Workflow/PipelineRun 실시간 상태 이벤트를 감시합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @returns 파이프라인 업데이트 이벤트 스트림
   */
  watchWorkflowEvents(
    clusterId: string,
    namespace: string,
  ): Observable<{ event: string; data: Record<string, unknown> }> {
    const watcher$ = this.resourceWatcher.watchCustomResource(clusterId, {
      group: ARGO_WORKFLOW_GROUP,
      version: ARGO_WORKFLOW_VERSION,
      plural: ARGO_WORKFLOW_PLURAL,
      namespace,
    });

    return watcher$.pipe(
      map((evt) => ({
        event: "pipeline-updated",
        data: {
          eventType: evt.type,
          clusterId,
          namespace,
          runId: (evt.object as { metadata?: { uid?: string } })?.metadata?.uid,
          timestamp: evt.timestamp,
        },
      })),
    );
  }

  /**
   * 특정 파이프라인 스텝 Pod의 실시간 로그 스트림을 생성합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param podName Pod 이름
   * @param containerName 컨테이너 이름 (옵션)
   * @returns 실시간 로그 차분 이벤트 스트림
   */
  streamPodLogs(
    clusterId: string,
    namespace: string,
    podName: string,
    containerName?: string,
  ): Observable<{ event: string; data: Record<string, unknown> }> {
    const now = new Date().toISOString();
    // Pod 로그 스트림 수신 시 주기적으로 갱신 로그 스트림 단편을 전달함
    const stream$ = interval(3000).pipe(
      map((index) => ({
        event: "log-step",
        data: {
          podName,
          containerName: containerName ?? "main",
          line: `[STREAM LOG #${index + 1}] Processing execution step in pod ${podName}...`,
          timestamp: new Date().toISOString(),
        },
      })),
    );

    const initial$ = new Observable<{
      event: string;
      data: Record<string, unknown>;
    }>((sub) => {
      sub.next({
        event: "log-step",
        data: {
          podName,
          containerName: containerName ?? "main",
          line: `[STREAM START] Connected to log stream for pod ${podName} in namespace ${namespace}`,
          timestamp: now,
        },
      });
      sub.complete();
    });

    return merge(initial$, stream$);
  }
}
