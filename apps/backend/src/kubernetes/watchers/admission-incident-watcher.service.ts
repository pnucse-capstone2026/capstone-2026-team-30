import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import {
  CoreV1Api,
  CoreV1Event,
  CustomObjectsApi,
  Informer,
  KubeConfig,
  KubernetesListObject,
  KubernetesObject,
  makeInformer,
} from "@kubernetes/client-node";
import { ClusterMetadata, ClusterProvider } from "../cluster-provider";
import { IncidentsService } from "../../incidents/incidents.service";

interface ArgoResourceSyncResult {
  group?: string;
  version?: string;
  kind?: string;
  namespace?: string;
  name?: string;
  status?: string;
  message?: string;
  hookStatus?: string;
}

interface ArgoApplicationObject extends KubernetesObject {
  spec?: {
    destination?: {
      namespace?: string;
      server?: string;
      name?: string;
    };
    source?: {
      repoURL?: string;
      targetRevision?: string;
      path?: string;
    };
  };
  status?: {
    sync?: {
      revision?: string;
      status?: string;
    };
    operationState?: {
      phase?: string;
      message?: string;
      syncResult?: {
        revision?: string;
        resources?: ArgoResourceSyncResult[];
      };
    };
  };
}

/**
 * Closed-Loop Admission Block 감지 및 인시던트 연동 워처 서비스
 *
 * 1. ArgoCD Application CRD Status를 감시하여 GitOps 파이프라인 상에서
 *    Kyverno Admission Webhook에 의해 차단된 리소스를 실시간 포착합니다.
 * 2. K8s Core Event (AdmissionWebhookDenied)를 보조 감지 소스로 병행 감시합니다.
 * 3. 감지된 차단 내역을 IncidentsService로 전달하여 중복 방지(Deduplication) 및 DB 영속화를 수행합니다.
 */
@Injectable()
export class AdmissionIncidentWatcherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdmissionIncidentWatcherService.name);
  private readonly informers: Informer<KubernetesObject>[] = [];

  constructor(
    private readonly incidentsService: IncidentsService,
    @Optional() private readonly clusterProvider?: ClusterProvider,
  ) {}

  /**
   * 모듈 기동 시 등록된 모든 클러스터에 대해 ArgoCD 및 Core Event Informer를 기동합니다.
   */
  async onModuleInit(): Promise<void> {
    if (!this.clusterProvider) {
      this.logger.debug(
        "[AdmissionWatcher] ClusterProvider not configured. Skipping watcher init.",
      );
      return;
    }

    const clusters = this.clusterProvider.list();
    for (const cluster of clusters) {
      this.initClusterWatchers(cluster);
    }
  }

  /**
   * 모듈 종료 시 모든 Informer 스트림을 안전하게 중단합니다.
   */
  async onModuleDestroy(): Promise<void> {
    for (const informer of this.informers) {
      try {
        informer.stop();
      } catch {
        // 종료 예외 무시
      }
    }
    this.informers.length = 0;
  }

  /**
   * 특정 클러스터에 대한 ArgoCD Application 및 Core Event 감시자를 초기화합니다.
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

    // 1. ArgoCD Application Informer (/apis/argoproj.io/v1alpha1/applications)
    this.startArgoApplicationInformer(cluster.id, kubeConfig);

    // 2. K8s Core Events Informer (/api/v1/events)
    this.startCoreEventInformer(cluster.id, kubeConfig);
  }

  /**
   * ArgoCD Application CRD Informer를 설정하고 변경 이벤트를 감시합니다.
   */
  private startArgoApplicationInformer(
    clusterId: string,
    kubeConfig: KubeConfig,
  ): void {
    const path = "/apis/argoproj.io/v1alpha1/applications";
    const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi);
    const listFn = async () => {
      const res = (await customObjectsApi.listClusterCustomObject({
        group: "argoproj.io",
        version: "v1alpha1",
        plural: "applications",
      })) as { items?: ArgoApplicationObject[] };
      return {
        apiVersion: "argoproj.io/v1alpha1",
        kind: "ApplicationList",
        items: Array.isArray(res?.items) ? res.items : [],
      } as KubernetesListObject<ArgoApplicationObject>;
    };

    try {
      const informer = makeInformer<ArgoApplicationObject>(
        kubeConfig,
        path,
        listFn as any,
      );

      informer.on("add", (obj: ArgoApplicationObject) => {
        this.processArgoApplication(clusterId, obj).catch((err) =>
          this.logger.error(
            `[AdmissionWatcher] Error processing Argo app add (${clusterId}): ${err.message}`,
          ),
        );
      });

      informer.on("update", (obj: ArgoApplicationObject) => {
        this.processArgoApplication(clusterId, obj).catch((err) =>
          this.logger.error(
            `[AdmissionWatcher] Error processing Argo app update (${clusterId}): ${err.message}`,
          ),
        );
      });

      informer.on("error", (err: unknown) => {
        // 클러스터에 ArgoCD CRD가 설치되어 있지 않은 일반 클러스터 환경 graceful fallback
        this.logger.debug(
          `[AdmissionWatcher] ArgoCD Informer notice for ${clusterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      informer.start().catch((err) => {
        this.logger.debug(
          `[AdmissionWatcher] ArgoCD Informer could not start for ${clusterId} (CRD may be absent): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      this.informers.push(informer as Informer<KubernetesObject>);
    } catch (err) {
      this.logger.debug(
        `[AdmissionWatcher] Failed to create ArgoCD informer for ${clusterId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * K8s Core Event Informer를 설정하고 AdmissionWebhookDenied 이벤트를 감시합니다.
   */
  private startCoreEventInformer(
    clusterId: string,
    kubeConfig: KubeConfig,
  ): void {
    const path = "/api/v1/events";
    const coreV1Api = kubeConfig.makeApiClient(CoreV1Api);
    const listFn = async () => {
      const res = await coreV1Api.listEventForAllNamespaces();
      return {
        apiVersion: "v1",
        kind: "EventList",
        items: Array.isArray(res?.items) ? res.items : [],
      } as KubernetesListObject<CoreV1Event>;
    };

    try {
      const informer = makeInformer<CoreV1Event>(
        kubeConfig,
        path,
        listFn as any,
      );

      informer.on("add", (event: CoreV1Event) => {
        this.processCoreEvent(clusterId, event).catch((err) =>
          this.logger.error(
            `[AdmissionWatcher] Error processing event add (${clusterId}): ${err.message}`,
          ),
        );
      });

      informer.on("update", (event: CoreV1Event) => {
        this.processCoreEvent(clusterId, event).catch((err) =>
          this.logger.error(
            `[AdmissionWatcher] Error processing event update (${clusterId}): ${err.message}`,
          ),
        );
      });

      informer.on("error", (err: unknown) => {
        this.logger.debug(
          `[AdmissionWatcher] Core Event Informer notice for ${clusterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      informer.start().catch((err) => {
        this.logger.debug(
          `[AdmissionWatcher] Core Event Informer could not start for ${clusterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      this.informers.push(informer as Informer<KubernetesObject>);
    } catch (err) {
      this.logger.debug(
        `[AdmissionWatcher] Failed to create Core Event informer for ${clusterId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * ArgoCD Application 객체의 syncResult 상태를 분석하여 Kyverno 차단 인시던트를 포착합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param app ArgoCD Application 리소스 객체
   */
  async processArgoApplication(
    clusterId: string,
    app: ArgoApplicationObject,
  ): Promise<void> {
    const syncResult = app.status?.operationState?.syncResult;
    if (!syncResult?.resources || syncResult.resources.length === 0) {
      return;
    }

    const appName = app.metadata?.name;
    const gitRepo = app.spec?.source?.repoURL;
    const gitCommitSha =
      syncResult.revision ||
      app.status?.sync?.revision ||
      app.spec?.source?.targetRevision;
    const defaultNamespace = app.spec?.destination?.namespace || "default";

    for (const res of syncResult.resources) {
      const message = res.message || "";
      const isFailed =
        res.status === "SyncFailed" || res.hookStatus === "Failed";

      if (isFailed || this.isKyvernoAdmissionDenial(message)) {
        if (!this.isKyvernoAdmissionDenial(message)) {
          continue;
        }

        const { policyName, ruleName, cleanReason } =
          this.parseAdmissionBlockMessage(message);

        const namespace = res.namespace || defaultNamespace;
        const resourceKind = res.kind || "Unknown";
        const resourceName = res.name || "Unknown";

        await this.incidentsService.recordAdmissionBlock({
          clusterId,
          namespace,
          resourceKind,
          resourceName,
          policyName,
          ruleName,
          blockReason: cleanReason,
          argoAppName: appName,
          gitCommitSha,
          gitRepository: gitRepo,
          metadata: {
            source: "ArgoCD",
            appName,
            group: res.group,
            version: res.version,
            rawMessage: message,
          },
        });
      }
    }
  }

  /**
   * K8s Core Event 객체를 분석하여 AdmissionWebhookDenied 차단 인시던트를 포착합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param event K8s Core V1 Event 객체
   */
  async processCoreEvent(clusterId: string, event: CoreV1Event): Promise<void> {
    const reason = event.reason || "";
    const message = event.message || "";

    if (!this.isKyvernoAdmissionDenial(message, reason)) {
      return;
    }

    const involved = event.involvedObject;
    if (!involved) return;

    const { policyName, ruleName, cleanReason } =
      this.parseAdmissionBlockMessage(message);

    const namespace = involved.namespace || "default";
    const resourceKind = involved.kind || "Unknown";
    const resourceName = involved.name || "Unknown";

    await this.incidentsService.recordAdmissionBlock({
      clusterId,
      namespace,
      resourceKind,
      resourceName,
      policyName,
      ruleName,
      blockReason: cleanReason,
      metadata: {
        source: "KubernetesCoreEvent",
        reason: event.reason,
        count: event.count,
        firstTimestamp: event.firstTimestamp,
        lastTimestamp: event.lastTimestamp,
        rawMessage: message,
      },
    });
  }

  /**
   * 주어진 메시지와 Event Reason이 Kyverno Admission Webhook 차단인지 판별합니다.
   */
  isKyvernoAdmissionDenial(message: string, reason?: string): boolean {
    const lowerMsg = message.toLowerCase();

    if (reason === "AdmissionWebhookDenied") {
      return true;
    }

    const hasWebhookDenial =
      lowerMsg.includes("denied the request") ||
      lowerMsg.includes("admission webhook") ||
      lowerMsg.includes("webhook denied");

    const hasKyvernoIndication =
      lowerMsg.includes("kyverno") ||
      lowerMsg.includes("validate.kyverno.svc") ||
      lowerMsg.includes("blocked due to the following policies");

    return hasWebhookDenial && hasKyvernoIndication;
  }

  /**
   * Kyverno Admission Webhook 오류 원문에서 정책명, 규칙명 및 정제된 사유를 파싱합니다.
   */
  parseAdmissionBlockMessage(rawMessage: string): {
    policyName: string;
    ruleName?: string;
    cleanReason: string;
  } {
    let policyName = "unknown-policy";
    let ruleName: string | undefined;

    // 패턴 1: [policy-name] 또는 [policy-name/rule-name] 형태 (예: [disallow-privileged-containers/check-privileged])
    const bracketMatch = rawMessage.match(
      /\[([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?\]/,
    );
    if (bracketMatch) {
      policyName = bracketMatch[1];
      if (bracketMatch[2]) {
        ruleName = bracketMatch[2];
      }
    } else {
      // 패턴 2: blocked due to the following policies\n\npolicy-name:\n  rule-name:
      const blockedPoliciesMatch = rawMessage.match(
        /(?:policies|policy):?\s*\n+([a-zA-Z0-9_-]+):(?:\s*\n+\s*([a-zA-Z0-9_-]+):)?/,
      );
      if (blockedPoliciesMatch) {
        policyName = blockedPoliciesMatch[1];
        if (blockedPoliciesMatch[2]) {
          ruleName = blockedPoliciesMatch[2];
        }
      }
    }

    // 정제된 사유 추출 (프리픽스 분리)
    let cleanReason = rawMessage;
    const prefixIndex = rawMessage.indexOf("denied the request:");
    if (prefixIndex !== -1) {
      cleanReason = rawMessage
        .substring(prefixIndex + "denied the request:".length)
        .trim();
    }

    return {
      policyName,
      ruleName,
      cleanReason,
    };
  }
}
