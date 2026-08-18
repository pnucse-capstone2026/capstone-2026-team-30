import { Injectable, Logger } from "@nestjs/common";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../../kubernetes/kyverno.adapter";
import { KubeflowAdapter } from "../notebooks/kubeflow.adapter";
import { GpuQuotaService, GpuQuotaStatus } from "./gpu-quota.service";
import { IdleWorkloadMonitorService } from "./idle-workload-monitor.service";

export type MlGovernanceOverview = {
  clusterId: string;
  namespace: string;
  gpuQuota: GpuQuotaStatus;
  notebooks: {
    total: number;
    active: number;
    idle: number;
    stopped: number;
  };
  costSavings: {
    estimatedMonthlySavingsUsd: number;
    estimatedDailySavingsUsd: number;
    autoStoppedCount: number;
  };
  policyViolationsCount: number;
};

export type MlPolicyViolation = {
  id: string;
  clusterId: string;
  namespace: string;
  policyName: string;
  ruleName: string;
  resourceKind: string;
  resourceName: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  detectedAt: string;
  remediation: string;
};

const ML_POLICY_NAMES = [
  "limit-gpu-per-namespace",
  "enforce-spot-node-selector",
  "disallow-untrusted-ml-images",
];

/**
 * MLOps 리소스 거버넌스, FinOps 클라우드 비용 절감액 계산 및 Kyverno ML 정책 준수 현황을 통합 관리하는 서비스입니다.
 */
@Injectable()
export class MlGovernanceService {
  private readonly logger = new Logger(MlGovernanceService.name);

  constructor(
    private readonly clusterProvider: ClusterProvider,
    private readonly kubeflowAdapter: KubeflowAdapter,
    private readonly kyvernoAdapter: KyvernoAdapter,
    private readonly gpuQuotaService: GpuQuotaService,
    private readonly idleMonitorService: IdleWorkloadMonitorService,
  ) {}

  /**
   * MLOps 리소스 현황, FinOps 비용 절감 및 정책 준수 지표를 집계하여 대시보드 개요 DTO를 반환합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param namespace 대상 네임스페이스 (기본: "default")
   * @returns MLOps 거버넌스 요약 정보
   */
  async getGovernanceOverview(
    clusterId: string,
    namespace: string = "default",
  ): Promise<MlGovernanceOverview> {
    const gpuQuota = await this.gpuQuotaService.getGpuQuotaStatus(
      clusterId,
      namespace,
    );

    let total = 0;
    let active = 0;
    let idle = 0;
    let stopped = 0;

    try {
      const notebooks = await this.kubeflowAdapter.listNotebooks(
        clusterId,
        namespace,
      );
      total = notebooks.length;

      for (const nb of notebooks) {
        const isStopped =
          nb.metadata?.annotations?.["kubeflow-resource-stopped"] === "true";
        if (isStopped) {
          stopped++;
        } else {
          // 실행 중인 개체 중 유휴 조건 충족 여부 체크
          const threshold =
            this.idleMonitorService.getSettings().idleThresholdHours;
          const creationTimestamp = nb.metadata?.creationTimestamp;
          let hoursRunning = 2;
          if (creationTimestamp) {
            hoursRunning = Math.floor(
              (Date.now() - new Date(creationTimestamp).getTime()) /
                (1000 * 60 * 60),
            );
          }

          if (hoursRunning >= threshold) {
            idle++;
          } else {
            active++;
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to list notebooks for overview calculation in ${clusterId}/${namespace}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const autoStoppedCount =
      this.idleMonitorService.getCumulativeStoppedCount() + stopped;

    // GPU 1대당 시간당 $1.50 절감 비용 추정치 산출
    const gpuCostPerHourUsd = 1.5;
    const avgGpusPerNotebook = 1;
    const hoursPerDaySaved = 12;

    const estimatedDailySavingsUsd =
      autoStoppedCount *
      avgGpusPerNotebook *
      gpuCostPerHourUsd *
      hoursPerDaySaved;
    const estimatedMonthlySavingsUsd = estimatedDailySavingsUsd * 30;

    const violations = await this.getMlPolicyViolations(clusterId, namespace);

    return {
      clusterId,
      namespace,
      gpuQuota,
      notebooks: {
        total,
        active,
        idle,
        stopped,
      },
      costSavings: {
        estimatedMonthlySavingsUsd: Math.round(estimatedMonthlySavingsUsd),
        estimatedDailySavingsUsd: Math.round(estimatedDailySavingsUsd),
        autoStoppedCount,
      },
      policyViolationsCount: violations.length,
    };
  }

  /**
   * 지정된 클러스터/네임스페이스에서 발생한 MLOps 관련 Kyverno 정책 위반 내역을 조회합니다.
   *
   * @param clusterId (선택) 클러스터 식별자
   * @param namespace (선택) 네임스페이스
   * @returns 정규화된 ML 정책 위반 목록 DTO
   */
  async getMlPolicyViolations(
    clusterId?: string,
    namespace?: string,
  ): Promise<MlPolicyViolation[]> {
    const targetClusters = clusterId
      ? this.clusterProvider.list().filter((c) => c.id === clusterId)
      : this.clusterProvider.list();

    const violations: MlPolicyViolation[] = [];

    for (const cluster of targetClusters) {
      try {
        const reports = await this.kyvernoAdapter.listNamespacedPolicyReports(
          cluster.id,
          namespace,
        );

        for (const r of reports) {
          const raw = r as {
            metadata?: { name?: string; namespace?: string };
            results?: Array<{
              policy?: string;
              rule?: string;
              severity?: string;
              result?: string;
              message?: string;
              resources?: Array<{
                kind?: string;
                name?: string;
                namespace?: string;
              }>;
            }>;
          };

          const results = raw.results ?? [];
          results.forEach((res, index) => {
            const policyName = res.policy ?? "";
            const isMlPolicy =
              ML_POLICY_NAMES.includes(policyName) ||
              policyName.includes("gpu") ||
              policyName.includes("ml") ||
              policyName.includes("spot");

            const outcome = res.result?.toLowerCase();
            if (
              isMlPolicy &&
              (outcome === "fail" || outcome === "warn" || outcome === "error")
            ) {
              const resObj = res.resources?.[0];
              const targetKind = resObj?.kind ?? "Pod";
              const targetName = resObj?.name ?? "unknown-ml-workload";
              const targetNs =
                resObj?.namespace ?? raw.metadata?.namespace ?? "default";

              let severity: "critical" | "high" | "medium" | "low" | "info" =
                "high";
              if (res.severity?.toLowerCase() === "critical")
                severity = "critical";
              else if (res.severity?.toLowerCase() === "medium")
                severity = "medium";
              else if (res.severity?.toLowerCase() === "low") severity = "low";

              violations.push({
                id: `${cluster.id}:${raw.metadata?.name ?? "report"}:${index}`,
                clusterId: cluster.id,
                namespace: targetNs,
                policyName,
                ruleName: res.rule ?? "ml-governance-rule",
                resourceKind: targetKind,
                resourceName: targetName,
                severity,
                message:
                  res.message ??
                  `ML policy '${policyName}' violation detected on ${targetKind}/${targetName}.`,
                detectedAt: new Date().toISOString(),
                remediation: this.getRemediationGuidance(policyName),
              });
            }
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch policy reports for ML violations in cluster ${cluster.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return violations;
  }

  private getRemediationGuidance(policyName: string): string {
    if (policyName.includes("gpu")) {
      return "Pod 또는 Notebook spec.resources.limits['nvidia.com/gpu']를 8개 이하로 조정하세요.";
    }
    if (policyName.includes("spot")) {
      return "TFJob/PyTorchJob spec에 nodeSelector(cloud.google.com/gke-spot: 'true') 및 tolerations를 추가하세요.";
    }
    if (policyName.includes("untrusted") || policyName.includes("image")) {
      return "컨테이너 이미지를 사내 승인된 ECR/Kubeflow 레지스트리(ecr.mycompany.com, quay.io/kubeflow 등)로 변경하세요.";
    }
    return "Kyverno ML 정책 명세에 맞추어 매니페스트를 수정한 후 재배포하세요.";
  }
}
