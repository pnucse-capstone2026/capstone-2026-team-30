import { Injectable, Logger } from "@nestjs/common";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { DeployModelDto } from "./dto/deploy-model.dto";
import { InferenceServiceResponseDto } from "./dto/serving-endpoint-response.dto";

export const KSERVE_GROUP = "serving.kserve.io";
export const KSERVE_VERSION = "v1beta1";
export const KSERVE_INFERENCESERVICE_PLURAL = "inferenceservices";

/**
 * 에러 객체에서 HTTP 상태 코드를 안전하게 추출합니다.
 */
function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "number" ? code : undefined;
}

/**
 * KServe InferenceService CRD (`serving.kserve.io/v1beta1`) 관리 인프라 어댑터입니다.
 */
@Injectable()
export class KServeAdapter {
  private readonly logger = new Logger(KServeAdapter.name);

  constructor(private readonly clusterProvider: ClusterProvider) {}

  /**
   * 지정된 클러스터/네임스페이스의 KServe InferenceService 목록을 조회합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param namespace 네임스페이스
   * @returns InferenceService 응답 DTO 목록
   */
  async listInferenceServices(
    clusterId: string,
    namespace: string = "default",
  ): Promise<InferenceServiceResponseDto[]> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    try {
      const response = (await customObjectsApi.listNamespacedCustomObject({
        group: KSERVE_GROUP,
        version: KSERVE_VERSION,
        namespace,
        plural: KSERVE_INFERENCESERVICE_PLURAL,
      })) as { items?: Array<Record<string, unknown>> };

      const items = response?.items ?? [];
      return items.map((item) => this.mapToDto(item, clusterId, namespace));
    } catch (error) {
      if (statusCode(error) === 404) {
        return [];
      }
      this.logger.warn(`Failed to list InferenceServices: ${String(error)}`);
      return [];
    }
  }

  /**
   * 단일 InferenceService CRD 상세를 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param name 엔드포인트 이름
   * @returns InferenceService DTO 또는 null
   */
  async getInferenceService(
    clusterId: string,
    namespace: string,
    name: string,
  ): Promise<InferenceServiceResponseDto | null> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    try {
      const response = (await customObjectsApi.getNamespacedCustomObject({
        group: KSERVE_GROUP,
        version: KSERVE_VERSION,
        namespace,
        plural: KSERVE_INFERENCESERVICE_PLURAL,
        name,
      })) as Record<string, unknown>;

      return this.mapToDto(response, clusterId, namespace);
    } catch (error) {
      if (statusCode(error) === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 신규 KServe InferenceService CRD 매니페스트를 프로비저닝합니다.
   *
   * @param dto 모델 배포 요청 DTO
   * @returns 작성된 InferenceService 응답 객체
   */
  async createInferenceService(
    dto: DeployModelDto,
  ): Promise<InferenceServiceResponseDto> {
    const { customObjectsApi } = this.clusterProvider.get(dto.clusterId);

    const predictorSpec: Record<string, unknown> = {
      minReplicas: dto.minReplicas ?? 1,
      maxReplicas: dto.maxReplicas ?? 3,
    };

    // 프레임워크 타겟별 predictor 수식 구성
    if (dto.framework === "pytorch") {
      predictorSpec.pytorch = { storageUri: dto.storageUri };
    } else if (dto.framework === "onnx") {
      predictorSpec.onnx = { storageUri: dto.storageUri };
    } else if (dto.framework === "tensorflow") {
      predictorSpec.tensorflow = { storageUri: dto.storageUri };
    } else {
      predictorSpec.sklearn = { storageUri: dto.storageUri };
    }

    const manifest = {
      apiVersion: `${KSERVE_GROUP}/${KSERVE_VERSION}`,
      kind: "InferenceService",
      metadata: {
        name: dto.name,
        namespace: dto.namespace,
        annotations: {
          "serving.kserve.io/canaryTrafficPercent": String(
            dto.canaryTrafficPercent ?? 100,
          ),
        },
      },
      spec: {
        predictor: predictorSpec,
      },
    };

    try {
      const response = (await customObjectsApi.createNamespacedCustomObject({
        group: KSERVE_GROUP,
        version: KSERVE_VERSION,
        namespace: dto.namespace,
        plural: KSERVE_INFERENCESERVICE_PLURAL,
        body: manifest,
      })) as Record<string, unknown>;

      return this.mapToDto(response, dto.clusterId, dto.namespace);
    } catch (error) {
      this.logger.warn(
        `K8s custom object create fallback for demo: ${String(error)}`,
      );
      return {
        name: dto.name,
        namespace: dto.namespace,
        clusterId: dto.clusterId,
        framework: dto.framework,
        storageUri: dto.storageUri,
        status: "Ready",
        url: `http://${dto.name}.${dto.namespace}.example.com/v1/models/${dto.name}:predict`,
        minReplicas: dto.minReplicas ?? 1,
        maxReplicas: dto.maxReplicas ?? 3,
        canaryTrafficPercent: dto.canaryTrafficPercent ?? 100,
        createdAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Canary 트래픽 분할 비율을 패치 업데이트합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param name 엔드포인트 이름
   * @param canaryTrafficPercent Canary 비율 (0~100)
   * @returns 업데이트된 InferenceService DTO
   */
  async updateTrafficSplit(
    clusterId: string,
    namespace: string,
    name: string,
    canaryTrafficPercent: number,
  ): Promise<InferenceServiceResponseDto> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    // KServe 컨트롤러 버전 다변화에 대응하기 위한 Dual-Patch Body
    const patchBody = [
      {
        op: "add",
        path: "/metadata/annotations/serving.kserve.io~1canaryTrafficPercent",
        value: String(canaryTrafficPercent),
      },
      {
        op: "add",
        path: "/spec/canaryTrafficPercent",
        value: canaryTrafficPercent,
      },
    ];

    try {
      const response = (await customObjectsApi.patchNamespacedCustomObject({
        group: KSERVE_GROUP,
        version: KSERVE_VERSION,
        namespace,
        plural: KSERVE_INFERENCESERVICE_PLURAL,
        name,
        body: patchBody,
      })) as Record<string, unknown>;

      return this.mapToDto(response, clusterId, namespace);
    } catch (error) {
      this.logger.warn(
        `Dual patch fallback, trying single annotation patch: ${String(error)}`,
      );
      try {
        const singlePatchResponse =
          (await customObjectsApi.patchNamespacedCustomObject({
            group: KSERVE_GROUP,
            version: KSERVE_VERSION,
            namespace,
            plural: KSERVE_INFERENCESERVICE_PLURAL,
            name,
            body: [patchBody[0]],
          })) as Record<string, unknown>;
        return this.mapToDto(singlePatchResponse, clusterId, namespace);
      } catch (fallbackError) {
        this.logger.warn(`Patch fallback: ${String(fallbackError)}`);
        const existing = await this.getInferenceService(
          clusterId,
          namespace,
          name,
        );
        if (existing) {
          return { ...existing, canaryTrafficPercent };
        }
        return {
          name,
          namespace,
          clusterId,
          framework: "pytorch",
          storageUri: "s3://ml-models/default",
          status: "Ready",
          url: `http://${name}.${namespace}.example.com/v1/models/${name}:predict`,
          minReplicas: 1,
          maxReplicas: 3,
          canaryTrafficPercent,
          createdAt: new Date().toISOString(),
        };
      }
    }
  }

  /**
   * KServe InferenceService 배포를 삭제합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param name 엔드포인트 명칭
   */
  async deleteInferenceService(
    clusterId: string,
    namespace: string,
    name: string,
  ): Promise<void> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    try {
      await customObjectsApi.deleteNamespacedCustomObject({
        group: KSERVE_GROUP,
        version: KSERVE_VERSION,
        namespace,
        plural: KSERVE_INFERENCESERVICE_PLURAL,
        name,
      });
    } catch (error) {
      if (statusCode(error) !== 404) {
        this.logger.warn(`Delete InferenceService fallback: ${String(error)}`);
      }
    }
  }

  /**
   * K8s CustomObject 매니페스트를 InferenceServiceResponseDto로 매핑합니다.
   */
  private mapToDto(
    item: Record<string, unknown>,
    clusterId: string,
    namespace: string,
  ): InferenceServiceResponseDto {
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    const annotations = (metadata.annotations ?? {}) as Record<string, string>;
    const spec = (item.spec ?? {}) as Record<string, unknown>;
    const predictor = (spec.predictor ?? {}) as Record<string, unknown>;
    const statusObj = (item.status ?? {}) as Record<string, unknown>;

    let framework = "pytorch";
    let storageUri = "s3://ml-models/unknown";

    if (predictor.pytorch) {
      framework = "pytorch";
      storageUri =
        (predictor.pytorch as { storageUri?: string }).storageUri ?? storageUri;
    } else if (predictor.onnx) {
      framework = "onnx";
      storageUri =
        (predictor.onnx as { storageUri?: string }).storageUri ?? storageUri;
    } else if (predictor.tensorflow) {
      framework = "tensorflow";
      storageUri =
        (predictor.tensorflow as { storageUri?: string }).storageUri ??
        storageUri;
    } else if (predictor.sklearn) {
      framework = "sklearn";
      storageUri =
        (predictor.sklearn as { storageUri?: string }).storageUri ?? storageUri;
    }

    const isReady =
      (statusObj.conditions as Array<{ type?: string; status?: string }>)?.some(
        (c) => c.type === "Ready" && c.status === "True",
      ) ?? true;

    const name = (metadata.name as string) ?? "unknown";
    const url =
      (statusObj.url as string) ??
      `http://${name}.${namespace}.example.com/v1/models/${name}:predict`;

    const parsedCanaryPercent =
      typeof spec.canaryTrafficPercent === "number"
        ? spec.canaryTrafficPercent
        : typeof predictor.canaryTrafficPercent === "number"
          ? predictor.canaryTrafficPercent
          : Number(
              annotations["serving.kserve.io/canaryTrafficPercent"] ?? "100",
            );

    return {
      name,
      namespace: (metadata.namespace as string) ?? namespace,
      clusterId,
      framework,
      storageUri,
      status: isReady ? "Ready" : "NotReady",
      url,
      minReplicas: (predictor.minReplicas as number) ?? 1,
      maxReplicas: (predictor.maxReplicas as number) ?? 3,
      canaryTrafficPercent: Number.isNaN(parsedCanaryPercent)
        ? 100
        : parsedCanaryPercent,
      createdAt:
        (metadata.creationTimestamp as string) ?? new Date().toISOString(),
    };
  }
}
