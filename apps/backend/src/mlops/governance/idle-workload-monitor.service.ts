import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ClusterProvider } from "../../kubernetes/cluster-provider";
import { KubeflowAdapter } from "../notebooks/kubeflow.adapter";
import { MlGovernanceEventBus } from "./ml-governance-event-bus.service";

export type GovernanceSettings = {
  idleThresholdHours: number;
  autoStopEnabled: boolean;
  notifyUser: boolean;
};

export type IdleInspectionResult = {
  scannedCount: number;
  idleDetectedCount: number;
  autoStoppedCount: number;
  stoppedNotebooks: Array<{
    clusterId: string;
    namespace: string;
    name: string;
    idleHours: number;
  }>;
};

/**
 * 장기간 미사용(Idle) 상태의 Jupyter Notebook 인스턴스를 자동으로 감지하고,
 * 설정된 임계 시간에 도달하면 안전하게 자동 종료(Stop)하여 클라우드 비용을 절감하는 서비스입니다.
 */
@Injectable()
export class IdleWorkloadMonitorService {
  private readonly logger = new Logger(IdleWorkloadMonitorService.name);

  private settings: GovernanceSettings = {
    idleThresholdHours: 2,
    autoStopEnabled: true,
    notifyUser: true,
  };

  private cumulativeStoppedCount = 0;

  constructor(
    private readonly clusterProvider: ClusterProvider,
    private readonly kubeflowAdapter: KubeflowAdapter,
    private readonly eventBus: MlGovernanceEventBus,
  ) {}

  /**
   * 현재 유휴 워크로드 자동 종료 설정 정보를 반환합니다.
   */
  getSettings(): GovernanceSettings {
    return { ...this.settings };
  }

  /**
   * 유휴 워크로드 자동 종료 설정을 변경합니다.
   *
   * @param updated 설정 변경 객체
   */
  updateSettings(updated: Partial<GovernanceSettings>): GovernanceSettings {
    if (
      updated.idleThresholdHours !== undefined &&
      updated.idleThresholdHours <= 0
    ) {
      throw new Error("Idle threshold hours must be greater than zero.");
    }
    this.settings = { ...this.settings, ...updated };
    this.logger.log(
      `Updated MLOps governance settings: ${JSON.stringify(this.settings)}`,
    );

    this.eventBus.emit("governance-updated", {
      action: "settings-updated",
      settings: this.getSettings(),
    });

    return this.getSettings();
  }

  /**
   * 지금까지 자동 종료 처리된 노트북의 총 누적 수량을 반환합니다.
   */
  getCumulativeStoppedCount(): number {
    return this.cumulativeStoppedCount;
  }

  /**
   * 5분 간격 스케줄러로 등록되어 유휴 노트북을 자동으로 검사하고 스케줄링 중지합니다.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleScheduledIdleCheck(): Promise<void> {
    if (!this.settings.autoStopEnabled) {
      this.logger.debug(
        "Auto-stop is currently disabled in settings. Skipping scheduled check.",
      );
      return;
    }

    try {
      const result = await this.checkAndShutdownIdleNotebooks();
      if (result.autoStoppedCount > 0) {
        this.logger.log(
          `Scheduled idle monitor automatically stopped ${result.autoStoppedCount} idle notebook(s).`,
        );
      }
    } catch (error) {
      this.logger.error(
        "Failed during scheduled idle workload check",
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * 특정 클러스터/네임스페이스 또는 전체 클러스터의 실행 중인 노트북을 정밀 검사하여
   * 유휴 임계치를 넘긴 인스턴스를 중지합니다.
   *
   * @param targetClusterId (선택) 특정 클러스터 식별자
   * @param targetNamespace (선택) 특정 네임스페이스
   * @returns 유휴 검사 및 자동 중지 결과 요약 DTO
   */
  async checkAndShutdownIdleNotebooks(
    targetClusterId?: string,
    targetNamespace: string = "default",
  ): Promise<IdleInspectionResult> {
    const clusters = targetClusterId
      ? this.clusterProvider.list().filter((c) => c.id === targetClusterId)
      : this.clusterProvider.list();

    const result: IdleInspectionResult = {
      scannedCount: 0,
      idleDetectedCount: 0,
      autoStoppedCount: 0,
      stoppedNotebooks: [],
    };

    for (const cluster of clusters) {
      try {
        const notebooks = await this.kubeflowAdapter.listNotebooks(
          cluster.id,
          targetNamespace,
        );

        for (const nb of notebooks) {
          result.scannedCount++;
          const name = nb.metadata?.name ?? "unknown";
          const namespace = nb.metadata?.namespace ?? targetNamespace;

          const isStopped =
            nb.metadata?.annotations?.["kubeflow-resource-stopped"] === "true";
          if (isStopped) continue;

          // 유휴 시간 판별 로직:
          // 1. 커스텀 activity annotation ('mlops.governance.io/last-activity') 확인
          // 2. 누락 시 creationTimestamp 및 인스턴스 특성 기준 계산
          const idleHours = this.calculateIdleHours(nb);

          if (idleHours >= this.settings.idleThresholdHours) {
            result.idleDetectedCount++;

            if (this.settings.autoStopEnabled) {
              await this.kubeflowAdapter.stopNotebook(
                cluster.id,
                namespace,
                name,
              );
              result.autoStoppedCount++;
              this.cumulativeStoppedCount++;
              result.stoppedNotebooks.push({
                clusterId: cluster.id,
                namespace,
                name,
                idleHours,
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to inspect notebooks for cluster ${cluster.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (result.autoStoppedCount > 0) {
      this.eventBus.emit(
        "governance-updated",
        {
          action: "idle-notebooks-stopped",
          autoStoppedCount: result.autoStoppedCount,
          stoppedNotebooks: result.stoppedNotebooks,
        },
        targetClusterId,
        targetNamespace,
      );
    }

    return result;
  }

  /**
   * 노트북의 유휴 시간을 계산합니다.
   */
  private calculateIdleHours(nb: Record<string, unknown>): number {
    const metadata = nb.metadata as
      | {
          annotations?: Record<string, string>;
          creationTimestamp?: string;
        }
      | undefined;

    const lastActivityStr =
      metadata?.annotations?.["mlops.governance.io/last-activity"];

    if (lastActivityStr) {
      const lastActivity = new Date(lastActivityStr).getTime();
      const diffMs = Date.now() - lastActivity;
      return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
    }

    if (metadata?.creationTimestamp) {
      const created = new Date(metadata.creationTimestamp).getTime();
      const diffMs = Date.now() - created;
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      return Math.max(1, hours);
    }

    return 2;
  }
}
