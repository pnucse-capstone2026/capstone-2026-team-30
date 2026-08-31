import { Injectable, MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { BusinessException } from "../../common/errors/business.exception";
import { MLOPS_ERROR } from "../mlops.errors";
import {
  KubeflowAdapter,
  KubeflowNotebookManifest,
  KUBEFLOW_GROUP,
  KUBEFLOW_VERSION,
} from "./kubeflow.adapter";
import { CreateNotebookDto } from "./dto/create-notebook.dto";
import {
  NotebookPresetsResponseDto,
  HardwareTierPresetDto,
  FrameworkImagePresetDto,
} from "./dto/notebook-preset.dto";
import {
  NotebookResponseDto,
  NotebookStateStatus,
} from "./dto/notebook-response.dto";
import type { AuthenticatedUser } from "../../auth/auth.types";

/**
 * 사전 정의된 하드웨어 티어 프리셋 카탈로그
 */
export const HARDWARE_PRESETS: Record<string, HardwareTierPresetDto> = {
  CPU_SMALL: {
    id: "CPU_SMALL",
    name: "Small CPU (1 Core / 2GB RAM)",
    cpuRequest: "0.5",
    cpuLimit: "1.0",
    memoryRequest: "1Gi",
    memoryLimit: "2Gi",
    gpuLimit: "0",
    isGpuRequired: false,
  },
  CPU_MEDIUM: {
    id: "CPU_MEDIUM",
    name: "Medium CPU (2 Core / 4GB RAM)",
    cpuRequest: "1.0",
    cpuLimit: "2.0",
    memoryRequest: "2Gi",
    memoryLimit: "4Gi",
    gpuLimit: "0",
    isGpuRequired: false,
  },
  GPU_T4_STANDARD: {
    id: "GPU_T4_STANDARD",
    name: "NVIDIA T4 GPU (4 Core / 16GB RAM / 1 GPU)",
    cpuRequest: "2.0",
    cpuLimit: "4.0",
    memoryRequest: "8Gi",
    memoryLimit: "16Gi",
    gpuLimit: "1",
    isGpuRequired: true,
  },
  GPU_A10G_HIGH: {
    id: "GPU_A10G_HIGH",
    name: "NVIDIA A10G High-Memory (8 Core / 32GB RAM / 1 GPU)",
    cpuRequest: "4.0",
    cpuLimit: "8.0",
    memoryRequest: "16Gi",
    memoryLimit: "32Gi",
    gpuLimit: "1",
    isGpuRequired: true,
  },
};

/**
 * 사전 정의된 머신러닝 Framework 및 Runtime 이미지 프리셋 카탈로그
 */
export const FRAMEWORK_PRESETS: Record<string, FrameworkImagePresetDto> = {
  JUPYTER_PYTORCH: {
    id: "JUPYTER_PYTORCH",
    name: "PyTorch 2.1 + CUDA 12.1 + JupyterLab",
    image: "kubeflownotebookswg/jupyter-pytorch-full:v1.8.0",
    type: "JupyterLab",
  },
  JUPYTER_TENSORFLOW: {
    id: "JUPYTER_TENSORFLOW",
    name: "TensorFlow 2.14 + CUDA 11.8 + JupyterLab",
    image: "kubeflownotebookswg/jupyter-tensorflow-full:v1.8.0",
    type: "JupyterLab",
  },
  JUPYTER_SCIPY: {
    id: "JUPYTER_SCIPY",
    name: "Jupyter Scipy Notebook (Python 3.11)",
    image: "kubeflownotebookswg/jupyter-scipy:v1.8.0",
    type: "JupyterLab",
  },
  RSTUDIO: {
    id: "RSTUDIO",
    name: "RStudio Server (R 4.3 + Tidyverse)",
    image: "kubeflownotebookswg/rstudio:v1.8.0",
    type: "RStudio",
  },
};

/**
 * MLOps Kubeflow Notebook의 전체 생명주기 관리 및 가상화 추상화 비즈니스 서비스입니다.
 */
@Injectable()
export class NotebooksService {
  constructor(private readonly kubeflowAdapter: KubeflowAdapter) {}

  /**
   * 이용 가능한 하드웨어 및 프레임워크 이미지 프리셋 목록을 반환합니다.
   */
  getPresets(): NotebookPresetsResponseDto {
    return {
      hardwareTiers: Object.values(HARDWARE_PRESETS),
      frameworkImages: Object.values(FRAMEWORK_PRESETS),
    };
  }

  /**
   * 사용자 권한 범위 내의 클러스터에서 프로비저닝된 Notebook 목록을 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 ID
   * @param namespace 조회 네임스페이스
   * @param user 인증된 요청 사용자
   */
  async listNotebooks(
    clusterId: string,
    namespace: string = "default",
    user: AuthenticatedUser,
  ): Promise<NotebookResponseDto[]> {
    this.validateClusterAccess(clusterId, user);

    const manifests = await this.kubeflowAdapter.listNotebooks(
      clusterId,
      namespace,
    );
    return manifests.map((manifest) =>
      this.mapManifestToDto(manifest, clusterId),
    );
  }

  /**
   * 단일 Notebook의 상세 정보를 조회합니다.
   *
   * @param clusterId 클러스터 ID
   * @param namespace 네임스페이스
   * @param name Notebook 명칭
   * @param user 인증된 요청 사용자
   * @throws {BusinessException} 존재하지 않거나 권한이 없을 시
   */
  async getNotebook(
    clusterId: string,
    namespace: string,
    name: string,
    user: AuthenticatedUser,
  ): Promise<NotebookResponseDto> {
    this.validateClusterAccess(clusterId, user);

    const manifest = await this.kubeflowAdapter.getNotebook(
      clusterId,
      namespace,
      name,
    );
    if (!manifest) {
      throw new BusinessException(MLOPS_ERROR.NOTEBOOK_NOT_FOUND);
    }

    return this.mapManifestToDto(manifest, clusterId);
  }

  /**
   * 데이터 사이언티스트를 위한 셀프서비스 폼 기반 신규 Notebook을 생성합니다.
   * 영구 홈 디렉토리 PVC를 자동 검증 및 생성한 후 Kubeflow Notebook CRD를 프로비저닝합니다.
   *
   * @param dto 생성 매개변수 DTO
   * @param user 인증된 요청 사용자
   */
  async createNotebook(
    dto: CreateNotebookDto,
    user: AuthenticatedUser,
  ): Promise<NotebookResponseDto> {
    this.validateClusterAccess(dto.clusterId, user);

    const namespace = dto.namespace || "default";

    // 1. 중복 Notebook 존재 여부 점검
    const existing = await this.kubeflowAdapter.getNotebook(
      dto.clusterId,
      namespace,
      dto.name,
    );
    if (existing) {
      throw new BusinessException(MLOPS_ERROR.NOTEBOOK_ALREADY_EXISTS);
    }

    // 2. 프레임워크 이미지 프리셋 및 하드웨어 사양 유효성 검증
    const fwPreset = FRAMEWORK_PRESETS[dto.frameworkImage];
    if (!fwPreset) {
      throw new BusinessException(MLOPS_ERROR.INVALID_PRESET);
    }

    let resourcesLimits: Record<string, string>;
    let resourcesRequests: Record<string, string>;

    if (dto.hardwareTier === "CUSTOM") {
      const cpu = dto.customCpu ?? 2;
      const mem = dto.customMemoryGb ?? 4;
      const gpu = dto.customGpu ?? 0;

      resourcesLimits = {
        cpu: `${cpu}`,
        memory: `${mem}Gi`,
      };
      resourcesRequests = {
        cpu: `${Math.max(0.5, cpu / 2)}`,
        memory: `${Math.max(1, Math.floor(mem / 2))}Gi`,
      };

      if (gpu > 0) {
        resourcesLimits["nvidia.com/gpu"] = `${gpu}`;
        resourcesRequests["nvidia.com/gpu"] = `${gpu}`;
      }
    } else {
      const hwPreset = HARDWARE_PRESETS[dto.hardwareTier];
      if (!hwPreset) {
        throw new BusinessException(MLOPS_ERROR.INVALID_PRESET);
      }

      resourcesLimits = {
        cpu: hwPreset.cpuLimit,
        memory: hwPreset.memoryLimit,
      };
      resourcesRequests = {
        cpu: hwPreset.cpuRequest,
        memory: hwPreset.memoryRequest,
      };

      if (hwPreset.isGpuRequired && Number(hwPreset.gpuLimit) > 0) {
        resourcesLimits["nvidia.com/gpu"] = hwPreset.gpuLimit;
        resourcesRequests["nvidia.com/gpu"] = hwPreset.gpuLimit;
      }
    }

    // 3. 사용자 전용 홈 디렉토리 PVC 보장 (/home/jovyan/work)
    const pvcName = `${dto.name}-workspace-pvc`;
    const storageGb = dto.storageGb || 10;
    try {
      await this.kubeflowAdapter.ensureWorkspacePvc(
        dto.clusterId,
        namespace,
        pvcName,
        storageGb,
      );
    } catch {
      throw new BusinessException(MLOPS_ERROR.NOTEBOOK_CREATION_FAILED);
    }

    const manifest: KubeflowNotebookManifest = {
      apiVersion: `${KUBEFLOW_GROUP}/${KUBEFLOW_VERSION}`,
      kind: "Notebook",
      metadata: {
        name: dto.name,
        namespace,
        labels: {
          app: "notebook",
          "mlops.kyverno.io/hardware-tier": dto.hardwareTier,
          "mlops.kyverno.io/framework-image": dto.frameworkImage,
        },
        annotations: {
          "notebooks.kubeflow.org/http-rewrite-uri": "/",
        },
      },
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: dto.name,
                image: fwPreset.image,
                resources: {
                  requests: resourcesRequests,
                  limits: resourcesLimits,
                },
                volumeMounts: [
                  {
                    name: "workspace-pvc",
                    mountPath: "/home/jovyan/work",
                  },
                ],
              },
            ],
            volumes: [
              {
                name: "workspace-pvc",
                persistentVolumeClaim: {
                  claimName: pvcName,
                },
              },
            ],
          },
        },
      },
    };

    // 5. K8s CRD 프로비저닝
    try {
      const created = await this.kubeflowAdapter.createNotebook(
        dto.clusterId,
        namespace,
        manifest,
      );
      return this.mapManifestToDto(created, dto.clusterId);
    } catch {
      throw new BusinessException(MLOPS_ERROR.NOTEBOOK_CREATION_FAILED);
    }
  }

  /**
   * 노트북 인스턴스를 중지(Stop)합니다.
   */
  async stopNotebook(
    clusterId: string,
    namespace: string,
    name: string,
    user: AuthenticatedUser,
  ): Promise<NotebookResponseDto> {
    this.validateClusterAccess(clusterId, user);

    const existing = await this.kubeflowAdapter.getNotebook(
      clusterId,
      namespace,
      name,
    );
    if (!existing) {
      throw new BusinessException(MLOPS_ERROR.NOTEBOOK_NOT_FOUND);
    }

    const updated = await this.kubeflowAdapter.stopNotebook(
      clusterId,
      namespace,
      name,
    );
    return this.mapManifestToDto(updated, clusterId);
  }

  /**
   * 중지된 노트북 인스턴스를 재시작(Start)합니다.
   */
  async startNotebook(
    clusterId: string,
    namespace: string,
    name: string,
    user: AuthenticatedUser,
  ): Promise<NotebookResponseDto> {
    this.validateClusterAccess(clusterId, user);

    const existing = await this.kubeflowAdapter.getNotebook(
      clusterId,
      namespace,
      name,
    );
    if (!existing) {
      throw new BusinessException(MLOPS_ERROR.NOTEBOOK_NOT_FOUND);
    }

    const updated = await this.kubeflowAdapter.startNotebook(
      clusterId,
      namespace,
      name,
    );
    return this.mapManifestToDto(updated, clusterId);
  }

  /**
   * 노트북 인스턴스를 삭제합니다.
   */
  async deleteNotebook(
    clusterId: string,
    namespace: string,
    name: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.validateClusterAccess(clusterId, user);

    const existing = await this.kubeflowAdapter.getNotebook(
      clusterId,
      namespace,
      name,
    );
    if (!existing) {
      throw new BusinessException(MLOPS_ERROR.NOTEBOOK_NOT_FOUND);
    }

    await this.kubeflowAdapter.deleteNotebook(clusterId, namespace, name);
  }

  /**
   * 노트북 직접 접속 URL을 반환합니다.
   */
  async getNotebookUrl(
    clusterId: string,
    namespace: string,
    name: string,
    user: AuthenticatedUser,
  ): Promise<{ url: string }> {
    const notebook = await this.getNotebook(clusterId, namespace, name, user);
    return {
      url:
        notebook.url ||
        `/api/v1/namespaces/${namespace}/services/http:${name}:80/proxy/`,
    };
  }

  /**
   * 지정된 클러스터 및 네임스페이스의 Notebook CRD 실시간 변경 이벤트 스트림을 구독합니다.
   *
   * @param clusterId 대상 클러스터 ID
   * @param namespace 대상 네임스페이스
   * @param user 인증된 요청 사용자
   */
  watchNotebookEvents(
    clusterId: string,
    namespace: string = "default",
    user: AuthenticatedUser,
  ): Observable<MessageEvent> {
    this.validateClusterAccess(clusterId, user);

    return this.kubeflowAdapter.watchNotebooks(clusterId, namespace).pipe(
      map((event) => {
        const notebook = this.mapManifestToDto(event.object, clusterId);
        return {
          data: {
            action: event.type,
            notebook,
            clusterId,
            namespace,
          },
          type: "notebook-updated",
        } as MessageEvent;
      }),
    );
  }

  /**
   * 요청 사용자의 클러스터 접근 권한을 확인합니다.
   */
  private validateClusterAccess(
    clusterId: string,
    user: AuthenticatedUser,
  ): void {
    if (user.role === "ADMIN") return;
    if (!user.clusterIds || !user.clusterIds.includes(clusterId)) {
      throw new BusinessException(MLOPS_ERROR.CLUSTER_ACCESS_DENIED);
    }
  }

  /**
   * Kubeflow Notebook K8s Manifest 객체를 REST Response DTO로 매핑합니다.
   */
  private mapManifestToDto(
    manifest: KubeflowNotebookManifest,
    clusterId: string,
  ): NotebookResponseDto {
    const name = manifest.metadata.name;
    const namespace = manifest.metadata.namespace || "default";
    const annotations = manifest.metadata.annotations || {};
    const labels = manifest.metadata.labels || {};
    const isStopped = annotations["kubeflow-resource-stopped"] === "true";

    let status: NotebookStateStatus = "Running";
    if (isStopped) {
      status = "Stopped";
    } else if (manifest.status?.conditions) {
      const readyCondition = manifest.status.conditions.find(
        (c) => c.type === "Ready",
      );
      if (readyCondition && readyCondition.status === "False") {
        status = "Pending";
      }
    }

    const container = manifest.spec?.template?.spec?.containers?.[0];
    const image = container?.image || "unknown";
    const limits = container?.resources?.limits || {};

    const hardwareTier = labels["mlops.kyverno.io/hardware-tier"] || "CUSTOM";
    const url = `/notebook/${namespace}/${name}/`;

    return {
      name,
      namespace,
      clusterId,
      status,
      image,
      hardwareTier,
      cpuLimit: limits.cpu || "1.0",
      memoryLimit: limits.memory || "2Gi",
      gpuLimit: limits["nvidia.com/gpu"] || "0",
      url,
      createdAt: manifest.metadata.creationTimestamp,
    };
  }
}
