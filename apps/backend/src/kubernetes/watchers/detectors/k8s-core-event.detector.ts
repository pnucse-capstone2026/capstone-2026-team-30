import {
  CoreV1Api,
  CoreV1Event,
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
 * 쿠버네티스 표준 Core V1 Event(/api/v1/events) 감시를 통한 어드미션 차단 감지기
 */
@Injectable()
export class CoreEventIncidentDetector implements IncidentDetector {
  readonly source = "KubernetesCoreEvent";
  private readonly logger = new Logger(CoreEventIncidentDetector.name);
  private readonly informers = new Map<string, Informer<KubernetesObject>>();

  async start(
    clusterId: string,
    kubeConfig: KubeConfig,
    onIncident: IncidentHandler,
  ): Promise<void> {
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
        this.processEvent(clusterId, event, onIncident).catch((err) =>
          this.logger.error(
            `[CoreEventDetector] Error processing event add (${clusterId}): ${err.message}`,
          ),
        );
      });

      informer.on("update", (event: CoreV1Event) => {
        this.processEvent(clusterId, event, onIncident).catch((err) =>
          this.logger.error(
            `[CoreEventDetector] Error processing event update (${clusterId}): ${err.message}`,
          ),
        );
      });

      informer.on("error", (err: unknown) => {
        this.logger.debug(
          `[CoreEventDetector] Core Event Informer notice for ${clusterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      informer.start().catch((err) => {
        this.logger.debug(
          `[CoreEventDetector] Core Event Informer could not start for ${clusterId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

      this.informers.set(clusterId, informer as Informer<KubernetesObject>);
    } catch (err) {
      this.logger.debug(
        `[CoreEventDetector] Failed to create Core Event informer for ${clusterId}: ${
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

  private async processEvent(
    clusterId: string,
    event: CoreV1Event,
    onIncident: IncidentHandler,
  ): Promise<void> {
    const reason = event.reason || "";
    const message = event.message || "";

    if (!isKyvernoAdmissionDenial(message, reason)) {
      return;
    }

    const involved = event.involvedObject;
    if (!involved) return;

    const { policyName, ruleName, cleanReason } =
      parseAdmissionBlockMessage(message);

    const namespace = involved.namespace || "default";
    const resourceKind = involved.kind || "Unknown";
    const resourceName = involved.name || "Unknown";

    await onIncident({
      clusterId,
      namespace,
      resourceKind,
      resourceName,
      policyName,
      ruleName,
      blockReason: cleanReason,
      metadata: {
        source: this.source,
        reason: event.reason,
        count: event.count,
        firstTimestamp: event.firstTimestamp,
        lastTimestamp: event.lastTimestamp,
        rawMessage: message,
      },
    });
  }
}
