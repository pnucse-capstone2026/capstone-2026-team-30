import { Injectable, Logger } from "@nestjs/common";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { KubeflowAdapter } from "../notebooks/kubeflow.adapter";

export type GpuQuotaStatus = {
  clusterId: string;
  namespace: string;
  totalLimit: number;
  usedGpus: number;
  availableGpus: number;
  usagePercentage: number;
};

/**
 * 네임스페이스 및 클러스터 단위의 GPU (`nvidia.com/gpu`) 할당량 및 실시간 사용률을 계산하는 서비스입니다.
 */
@Injectable()
export class GpuQuotaService {
  private readonly logger = new Logger(GpuQuotaService.name);

  constructor(
    private readonly clusterProvider: ClusterProvider,
    private readonly kubeflowAdapter: KubeflowAdapter,
  ) {}

  /**
   * 지정된 클러스터 및 네임스페이스의 GPU 쿼터 한도와 현재 사용 현황을 평가합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 조회 대상 네임스페이스 (기본: "default")
   * @returns GPU 쿼터 전체 한도, 사용량, 잔여 수량 및 사용 비율 DTO
   */
  async getGpuQuotaStatus(
    clusterId: string,
    namespace: string = "default",
  ): Promise<GpuQuotaStatus> {
    // 네임스페이스 기본 GPU 쿼터 한도 (디폴트 16개 GPU)
    const defaultTotalLimit = 16;

    try {
      const notebooks = await this.kubeflowAdapter.listNotebooks(
        clusterId,
        namespace,
      );

      // 실행 중인 노트북 컨테이너의 GPU 요청량 수집
      let usedGpus = 0;
      for (const nb of notebooks) {
        const isStopped =
          nb.metadata?.annotations?.["kubeflow-resource-stopped"] === "true";
        if (isStopped) continue;

        const containers = nb.spec?.template?.spec?.containers ?? [];
        for (const container of containers) {
          const gpuReq =
            container.resources?.limits?.["nvidia.com/gpu"] ??
            container.resources?.requests?.["nvidia.com/gpu"];
          if (gpuReq) {
            const parsed = parseInt(gpuReq, 10);
            if (!isNaN(parsed)) {
              usedGpus += parsed;
            }
          }
        }
      }

      const totalLimit = defaultTotalLimit;
      const availableGpus = Math.max(0, totalLimit - usedGpus);
      const usagePercentage = Math.min(
        100,
        Math.round((usedGpus / totalLimit) * 100),
      );

      return {
        clusterId,
        namespace,
        totalLimit,
        usedGpus,
        availableGpus,
        usagePercentage,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to calculate GPU quota for cluster ${clusterId}/${namespace}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        clusterId,
        namespace,
        totalLimit: defaultTotalLimit,
        usedGpus: 0,
        availableGpus: defaultTotalLimit,
        usagePercentage: 0,
      };
    }
  }
}
