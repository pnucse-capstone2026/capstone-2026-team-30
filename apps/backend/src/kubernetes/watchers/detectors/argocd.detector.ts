import {
  CustomObjectsApi,
  Informer,
  KubeConfig,
  KubernetesListObject,
  KubernetesObject,
  makeInformer,
} from "@kubernetes/client-node";
import { Injectable, Logger } from "@nestjs/common";
import {
  IncidentDetector,
  IncidentHandler,
} from "../interfaces/incident-detector.interface";
import {
  isKyvernoAdmissionDenial,
  parseAdmissionBlockMessage,
} from "../helpers/admission-message-parser";

/**
 * ArgoCD Application CRD 스펙 타입
 */
interface ArgoApplicationObject extends KubernetesObject {
  spec?: {
    source?: {
      repoURL?: string;
      targetRevision?: string;
    };
    destination?: {
      namespace?: string;
      server?: string;
    };
  };
  status?: {
    sync?: {
      revision?: string;
      status?: string;
    };
    operationState?: {
      syncResult?: {
        revision?: string;
        resources?: Array<{
          group?: string;
          version?: string;
          kind?: string;
          name?: string;
          namespace?: string;
          status?: string;
          message?: string;
          hookStatus?: string;
        }>;
      };
    };
  };
}

/**
 * ArgoCD Application CRD Status를 감시하여 배포 차단 인시던트를 포착하는 감지기 구현체
 */
@Injectable()
export class ArgoCdIncidentDetector implements IncidentDetector {
  readonly source = "ArgoCD";
  private readonly logger = new Logger(ArgoCdIncidentDetector.name);
  private readonly informers = new Map<string, Informer<KubernetesObject>>();

  async start(
    clusterId: string,
    kubeConfig: KubeConfig,
    onIncident: IncidentHandler,
  ): Promise<void> {
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
        this.processApplication(clusterId, obj, onIncident).catch((err) =>
          this.logger.error(
            `[ArgoCdDetector] Error processing Argo app add (${clusterId}): ${err.message}`,
          ),
        );
      });

      informer.on("update", (obj: ArgoApplicationObject) => {
        this.processApplication(clusterId, obj, onIncident).catch((err) =>
          this.logger.error(
            `[ArgoCdDetector] Error processing Argo app update (${clusterId}): ${err.message}`,
          ),
        );
      });

      informer.on("error", (err: unknown) => {
        // 클러스터에 ArgoCD CRD가 미설치된 일반 클러스터 환경 graceful fallback
        this.logger.debug(
          `[ArgoCdDetector] ArgoCD Informer notice for ${clusterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      informer.start().catch((err) => {
        this.logger.debug(
          `[ArgoCdDetector] ArgoCD Informer could not start for ${clusterId} (CRD may be absent): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      this.informers.set(clusterId, informer as Informer<KubernetesObject>);
    } catch (err) {
      this.logger.debug(
        `[ArgoCdDetector] Failed to create ArgoCD informer for ${clusterId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async stop(clusterId?: string): Promise<void> {
    if (clusterId) {
      const informer = this.informers.get(clusterId);
      if (informer) {
        try {
          informer.stop();
        } catch {
          // 중단 에러 무시
        }
        this.informers.delete(clusterId);
      }
      return;
    }

    for (const informer of this.informers.values()) {
      try {
        informer.stop();
      } catch {
        // 무시
      }
    }
    this.informers.clear();
  }

  private async processApplication(
    clusterId: string,
    app: ArgoApplicationObject,
    onIncident: IncidentHandler,
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

      if (isFailed || isKyvernoAdmissionDenial(message)) {
        if (!isKyvernoAdmissionDenial(message)) {
          continue;
        }

        const { policyName, ruleName, cleanReason } =
          parseAdmissionBlockMessage(message);

        const namespace = res.namespace || defaultNamespace;
        const resourceKind = res.kind || "Unknown";
        const resourceName = res.name || "Unknown";

        await onIncident({
          clusterId,
          namespace,
          resourceKind,
          resourceName,
          policyName,
          ruleName,
          blockReason: cleanReason,
          gitopsAppName: appName,
          gitCommitSha,
          gitRepository: gitRepo,
          metadata: {
            source: this.source,
            appName,
            group: res.group,
            version: res.version,
            rawMessage: message,
          },
        });
      }
    }
  }
}
