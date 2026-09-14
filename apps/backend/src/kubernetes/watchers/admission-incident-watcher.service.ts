import { KubeConfig } from "@kubernetes/client-node";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { IncidentsService } from "../../incidents/incidents.service";
import { ClusterMetadata, ClusterProvider } from "../cluster-provider";
import { IncidentDetector } from "./interfaces/incident-detector.interface";
import { CoreEventIncidentDetector } from "./detectors/k8s-core-event.detector";
import { ArgoCdIncidentDetector } from "./detectors/argocd.detector";
import { FluxCdIncidentDetector } from "./detectors/fluxcd.detector";
import {
  isKyvernoAdmissionDenial,
  parseAdmissionBlockMessage,
} from "./helpers/admission-message-parser";

import { K8sLeaderElectorService } from "../coordination/k8s-leader-elector.service";

/**
 * Closed-Loop Admission Block 감지 및 인시던트 연동 오케스트레이터 워처 서비스
 *
 * 등록된 다양한 IncidentDetector(K8s Core Event, ArgoCD, Flux CD 등)를 총괄 관리하며,
 * 포착된 차단 이벤트를 IncidentsService로 전달하여 중복 방지 및 영속화를 수행합니다.
 */
@Injectable()
export class AdmissionIncidentWatcherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdmissionIncidentWatcherService.name);
  private readonly detectors: IncidentDetector[];
  private isRunning = false;

  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly coreEventDetector: CoreEventIncidentDetector,
    private readonly argoCdDetector: ArgoCdIncidentDetector,
    private readonly fluxCdDetector: FluxCdIncidentDetector,
    @Optional() private readonly clusterProvider?: ClusterProvider,
    @Optional() private readonly leaderElector?: K8sLeaderElectorService,
  ) {
    this.detectors = [
      this.coreEventDetector,
      this.argoCdDetector,
      this.fluxCdDetector,
    ];
  }

  /**
   * 모듈 초기화 시 리더 선출 상태에 따라 감지기를 기동합니다.
   * 리더 일렉터가 주입된 경우 onLeaderAcquired 시에만 start()하고, onLeaderLost 시 stop()합니다.
   */
  async onModuleInit(): Promise<void> {
    if (this.leaderElector) {
      this.leaderElector.onLeaderAcquired(() => {
        this.logger.log(
          "[AdmissionWatcher] Leader lease acquired. Starting admission watchers...",
        );
        this.start();
      });

      this.leaderElector.onLeaderLost(() => {
        this.logger.warn(
          "[AdmissionWatcher] Leader lease lost. Stopping admission watchers...",
        );
        void this.stop();
      });
    } else {
      this.start();
    }
  }

  /**
   * 등록된 모든 클러스터에 대해 인시던트 감지기(Watcher)들을 가동합니다.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }
    if (!this.clusterProvider) {
      this.logger.debug(
        "[AdmissionWatcher] ClusterProvider not configured. Skipping watcher init.",
      );
      return;
    }

    this.isRunning = true;
    const clusters = this.clusterProvider.list();
    for (const cluster of clusters) {
      this.initClusterWatchers(cluster);
    }
    this.logger.log("[AdmissionWatcher] Watchers successfully started.");
  }

  /**
   * 실행 중인 모든 감지기 스트림을 즉시 중단합니다.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    for (const detector of this.detectors) {
      try {
        await detector.stop();
      } catch {
        // 종료 예외 무시
      }
    }
    this.logger.log("[AdmissionWatcher] Watchers successfully stopped.");
  }

  /**
   * 모듈 종료 시 모든 감지기 스트림을 안전하게 중단합니다.
   */
  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * 특정 클러스터에 대한 모든 인시던트 감지기를 초기화합니다.
   *
   * @param cluster 대상 클러스터 메타데이터
   */
  initClusterWatchers(cluster: ClusterMetadata): void {
    if (!this.clusterProvider) return;

    let kubeConfig: KubeConfig;
    try {
      kubeConfig = this.clusterProvider.getKubeConfig(cluster.id);
    } catch (err) {
      this.logger.debug(
        `[AdmissionWatcher] Skipped watcher initialization for cluster ${cluster.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    for (const detector of this.detectors) {
      detector
        .start(cluster.id, kubeConfig, async (event) => {
          await this.incidentsService.recordAdmissionBlock({
            clusterId: event.clusterId,
            namespace: event.namespace,
            resourceKind: event.resourceKind,
            resourceName: event.resourceName,
            policyName: event.policyName,
            ruleName: event.ruleName,
            blockReason: event.blockReason,
            gitopsAppName: event.gitopsAppName,
            gitCommitSha: event.gitCommitSha,
            gitRepository: event.gitRepository,
            metadata: event.metadata,
          });
        })
        .catch((err) => {
          this.logger.warn(
            `[AdmissionWatcher] Failed to start detector ${detector.source} for cluster ${cluster.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }
  }

  /**
   * 주어진 메시지와 Event Reason이 Kyverno Admission Webhook 차단인지 판별합니다. (헬퍼 위임)
   */
  isKyvernoAdmissionDenial(message: string, reason?: string): boolean {
    return isKyvernoAdmissionDenial(message, reason);
  }

  /**
   * Kyverno Admission Webhook 오류 원문에서 정책명, 규칙명 및 정제된 사유를 파싱합니다. (헬퍼 위임)
   */
  parseAdmissionBlockMessage(rawMessage: string): {
    policyName: string;
    ruleName?: string;
    cleanReason: string;
  } {
    return parseAdmissionBlockMessage(rawMessage);
  }
}
