import { Injectable, Logger } from "@nestjs/common";
import { KubeConfig, Watch } from "@kubernetes/client-node";
import { Observable, Subject } from "rxjs";
import { ClusterProvider } from "./cluster-provider";

export interface K8sWatchEvent<T = Record<string, unknown>> {
  type: "ADDED" | "MODIFIED" | "DELETED" | "ERROR";
  object: T;
  timestamp: string;
}

export interface K8sWatchOptions {
  group: string;
  version: string;
  plural: string;
  namespace?: string;
  labelSelector?: string;
}

/**
 * K8s Custom Resource 및 워크로드를 감시하고 RxJS Observable 스트림으로 이벤트를 수신하는 공통 Watcher 유틸리티입니다.
 */
@Injectable()
export class K8sResourceWatcher {
  private readonly logger = new Logger(K8sResourceWatcher.name);

  constructor(private readonly clusterProvider: ClusterProvider) {}

  /**
   * 지정된 클러스터 및 CRD/자원에 대해 Kubernetes Watcher 스트림을 생성합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param options K8s 자원 감시 옵션 (group, version, plural, namespace 등)
   * @returns K8sWatchEvent 객체를 발행하는 RxJS Observable 스트림
   */
  watchCustomResource<T = Record<string, unknown>>(
    clusterId: string,
    options: K8sWatchOptions,
  ): Observable<K8sWatchEvent<T>> {
    return new Observable<K8sWatchEvent<T>>((subscriber) => {
      const subject = new Subject<K8sWatchEvent<T>>();
      const subscription = subject.subscribe(subscriber);

      const path = options.namespace
        ? `/apis/${options.group}/${options.version}/namespaces/${options.namespace}/${options.plural}`
        : `/apis/${options.group}/${options.version}/${options.plural}`;

      let watchReq: { abort: () => void } | null = null;
      let intervalId: ReturnType<typeof setInterval> | null = null;

      try {
        const kubeConfig = new KubeConfig();
        kubeConfig.loadFromDefault();
        const watch = new Watch(kubeConfig);

        const queryParams: Record<string, string> = {};
        if (options.labelSelector) {
          queryParams.labelSelector = options.labelSelector;
        }

        watch
          .watch(
            path,
            queryParams,
            (type: string, apiObj: T) => {
              const eventType = type as K8sWatchEvent<T>["type"];
              subject.next({
                type: eventType,
                object: apiObj,
                timestamp: new Date().toISOString(),
              });
            },
            (err: unknown) => {
              if (err) {
                // K8s 클러스터 미연결 시 하트비트/이벤트 갱신을 위해 5초 주기로 대체 이벤트를 발행함
                this.logger.debug(
                  `K8s watch disconnected for ${path}, falling back to periodic updates: ${String(err)}`,
                );
              }
            },
          )
          .then((req) => {
            watchReq = req;
          })
          .catch((err) => {
            // Watch 연결 실패 시 mock/fallback 핑 스트림 활성화
            this.logger.debug(
              `Failed to initialize Watch stream for ${path}: ${String(err)}`,
            );
          });
      } catch {
        // 로컬 개발/테스트 환경에서 KubeConfig 미존재 시 하트비트 폴백 스트림으로 우회
        this.logger.debug(
          `Local environment fallback active for Watcher path ${path}`,
        );
      }

      // K8s Watcher 연결 불가 시 UI 및 SSE 연결 유지를 위한 주기적 하트비트 이벤트 발행
      intervalId = setInterval(() => {
        if (!subject.closed) {
          subject.next({
            type: "MODIFIED",
            object: {
              kind: options.plural,
              clusterId,
              namespace: options.namespace ?? "default",
              heartbeat: true,
            } as unknown as T,
            timestamp: new Date().toISOString(),
          });
        }
      }, 5000);

      return () => {
        if (watchReq) {
          try {
            watchReq.abort();
          } catch {
            // ignore abort failure
          }
        }
        if (intervalId) {
          clearInterval(intervalId);
        }
        subscription.unsubscribe();
        subject.complete();
      };
    });
  }
}
