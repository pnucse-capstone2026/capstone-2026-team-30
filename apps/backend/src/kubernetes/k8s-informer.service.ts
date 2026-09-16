import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import {
  Informer,
  KubeConfig,
  KubernetesListObject,
  KubernetesObject,
  ObjectCache,
  makeInformer,
} from "@kubernetes/client-node";
import { ClusterMetadata, ClusterProvider } from "./cluster-provider";

export type InformerResourceType =
  | "policyreports"
  | "clusterpolicyreports"
  | "clusterpolicies"
  | "policyexceptions";

type InformerInstance = Informer<KubernetesObject> &
  ObjectCache<KubernetesObject>;

interface ClusterInformerRegistry {
  clusterId: string;
  informers: Map<InformerResourceType, InformerInstance>;
  ready: Map<InformerResourceType, boolean>;
}

const KYVERNO_GROUP = "kyverno.io";
const POLICY_VERSION = "v1";
const POLICY_PLURAL = "clusterpolicies";
const EXCEPTION_VERSION = "v2beta1";
const EXCEPTION_PLURAL = "policyexceptions";

const WG_POLICY_GROUP = "wgpolicyk8s.io";
const POLICY_REPORT_VERSION = "v1alpha2";
const POLICY_REPORT_PLURAL = "policyreports";
const CLUSTER_POLICY_REPORT_PLURAL = "clusterpolicyreports";

import { K8sLeaderElectorService } from "./coordination/k8s-leader-elector.service";

/**
 * AWS EKS Control Plane의 API 스로틀링(429) 및 Cross-VPC 통신 지연을 방지하기 위해
 * Kyverno 핵심 CRD(PolicyReport, ClusterPolicyReport, ClusterPolicy, PolicyException)를
 * In-Memory 캐시로 동기화하고 관리하는 Informer 서비스입니다.
 */
@Injectable()
export class K8sInformerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(K8sInformerService.name);
  private readonly registries = new Map<string, ClusterInformerRegistry>();
  private readonly changeListeners: Array<
    (
      clusterId: string,
      resourceType: InformerResourceType,
      eventType: "add" | "update" | "delete",
      obj: KubernetesObject,
    ) => void
  > = [];
  private isRunning = false;

  constructor(
    @Optional() private readonly clusterProvider?: ClusterProvider,
    @Optional() private readonly leaderElector?: K8sLeaderElectorService,
  ) {}

  /**
   * 모듈 초기화 시 리더 선출 상태에 따라 Informer를 기동합니다.
   * 리더 일렉터가 주입된 경우 onLeaderAcquired 시에만 start()하고, onLeaderLost 시 stop()합니다.
   */
  async onModuleInit(): Promise<void> {
    if (this.leaderElector) {
      this.leaderElector.onLeaderAcquired(() => {
        this.logger.log(
          "[Informer] Leader lease acquired. Starting K8s informers...",
        );
        this.start();
      });

      this.leaderElector.onLeaderLost(() => {
        this.logger.warn(
          "[Informer] Leader lease lost. Stopping K8s informers...",
        );
        void this.stop();
      });
    } else {
      this.start();
    }
  }

  /**
   * 등록된 모든 클러스터에 대해 Informer 캐시 동기화 스트림을 기동합니다.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }
    if (!this.clusterProvider) {
      return;
    }

    this.isRunning = true;
    const clusters = this.clusterProvider.list();
    for (const cluster of clusters) {
      this.initClusterInformers(cluster);
    }
    this.logger.log("[Informer] K8s Informers successfully started.");
  }

  /**
   * 활성화된 모든 Informer 스트림을 안전하게 중단하고 캐시 레지스트리를 비웁니다.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    for (const [clusterId, registry] of this.registries) {
      for (const [resourceType, informer] of registry.informers) {
        try {
          informer.stop();
          this.logger.debug(
            `[Informer] Stopped informer for ${clusterId}/${resourceType}`,
          );
        } catch {
          // 종료 예외 무시
        }
      }
    }
    this.registries.clear();
    this.logger.log("[Informer] K8s Informers successfully stopped.");
  }

  /**
   * 모듈 종료 시 활성화된 모든 Informer 스트림을 안전하게 중단합니다.
   */
  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * 특정 클러스터에 대한 Informer 레지스트리를 초기화하고 감시(Watch)를 시작합니다.
   *
   * @param cluster 클러스터 메타데이터
   */
  initClusterInformers(cluster: ClusterMetadata): void {
    if (!this.clusterProvider) return;

    let kubeConfig: KubeConfig;
    try {
      kubeConfig = this.clusterProvider.getKubeConfig(cluster.id);
    } catch (err) {
      this.logger.debug(
        `[Informer] Skipped informer initialization for ${cluster.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const registry: ClusterInformerRegistry = {
      clusterId: cluster.id,
      informers: new Map(),
      ready: new Map(),
    };
    this.registries.set(cluster.id, registry);

    const connection = this.clusterProvider.get(cluster.id);

    // 1. PolicyReports Informer (/apis/wgpolicyk8s.io/v1alpha2/policyreports)
    this.registerInformer(
      registry,
      cluster.id,
      kubeConfig,
      "policyreports",
      `/apis/${WG_POLICY_GROUP}/${POLICY_REPORT_VERSION}/${POLICY_REPORT_PLURAL}`,
      async () => {
        const res = (await connection.customObjectsApi.listClusterCustomObject({
          group: WG_POLICY_GROUP,
          version: POLICY_REPORT_VERSION,
          plural: POLICY_REPORT_PLURAL,
        })) as { items?: KubernetesObject[] };
        return {
          apiVersion: `${WG_POLICY_GROUP}/${POLICY_REPORT_VERSION}`,
          kind: "PolicyReportList",
          items: Array.isArray(res?.items) ? res.items : [],
        };
      },
    );

    // 2. ClusterPolicyReports Informer (/apis/wgpolicyk8s.io/v1alpha2/clusterpolicyreports)
    this.registerInformer(
      registry,
      cluster.id,
      kubeConfig,
      "clusterpolicyreports",
      `/apis/${WG_POLICY_GROUP}/${POLICY_REPORT_VERSION}/${CLUSTER_POLICY_REPORT_PLURAL}`,
      async () => {
        const res = (await connection.customObjectsApi.listClusterCustomObject({
          group: WG_POLICY_GROUP,
          version: POLICY_REPORT_VERSION,
          plural: CLUSTER_POLICY_REPORT_PLURAL,
        })) as { items?: KubernetesObject[] };
        return {
          apiVersion: `${WG_POLICY_GROUP}/${POLICY_REPORT_VERSION}`,
          kind: "ClusterPolicyReportList",
          items: Array.isArray(res?.items) ? res.items : [],
        };
      },
    );

    // 3. ClusterPolicies Informer (/apis/kyverno.io/v1/clusterpolicies)
    this.registerInformer(
      registry,
      cluster.id,
      kubeConfig,
      "clusterpolicies",
      `/apis/${KYVERNO_GROUP}/${POLICY_VERSION}/${POLICY_PLURAL}`,
      async () => {
        const res = (await connection.customObjectsApi.listClusterCustomObject({
          group: KYVERNO_GROUP,
          version: POLICY_VERSION,
          plural: POLICY_PLURAL,
        })) as { items?: KubernetesObject[] };
        return {
          apiVersion: `${KYVERNO_GROUP}/${POLICY_VERSION}`,
          kind: "ClusterPolicyList",
          items: Array.isArray(res?.items) ? res.items : [],
        };
      },
    );

    // 4. PolicyExceptions Informer (/apis/kyverno.io/v2beta1/policyexceptions)
    this.registerInformer(
      registry,
      cluster.id,
      kubeConfig,
      "policyexceptions",
      `/apis/${KYVERNO_GROUP}/${EXCEPTION_VERSION}/${EXCEPTION_PLURAL}`,
      async () => {
        try {
          const res =
            (await connection.customObjectsApi.listClusterCustomObject({
              group: KYVERNO_GROUP,
              version: EXCEPTION_VERSION,
              plural: EXCEPTION_PLURAL,
            })) as { items?: KubernetesObject[] };
          return {
            apiVersion: `${KYVERNO_GROUP}/${EXCEPTION_VERSION}`,
            kind: "PolicyExceptionList",
            items: Array.isArray(res?.items) ? res.items : [],
          };
        } catch (err: unknown) {
          const statusCode =
            (err as { statusCode?: number })?.statusCode ||
            (err as { response?: { statusCode?: number } })?.response
              ?.statusCode;
          if (statusCode === 403) {
            this.logger.warn(
              `[Informer] Cluster-wide list forbidden (403) for policyexceptions on cluster '${cluster.id}'. Falling back to namespaced list in '${connection.exceptionNamespace}'.`,
            );
            const res =
              (await connection.customObjectsApi.listNamespacedCustomObject({
                group: KYVERNO_GROUP,
                version: EXCEPTION_VERSION,
                namespace: connection.exceptionNamespace,
                plural: EXCEPTION_PLURAL,
              })) as { items?: KubernetesObject[] };
            return {
              apiVersion: `${KYVERNO_GROUP}/${EXCEPTION_VERSION}`,
              kind: "PolicyExceptionList",
              items: Array.isArray(res?.items) ? res.items : [],
            };
          }
          throw err;
        }
      },
    );
  }

  /**
   * 개별 리소스 Informer를 등록하고 이벤트 리스너를 바인딩합니다.
   */
  private registerInformer(
    registry: ClusterInformerRegistry,
    clusterId: string,
    kubeConfig: KubeConfig,
    resourceType: InformerResourceType,
    path: string,
    listFn: () => Promise<KubernetesListObject<KubernetesObject>>,
  ): void {
    try {
      const informer = makeInformer<KubernetesObject>(kubeConfig, path, listFn);

      informer.on("add", (obj: KubernetesObject) => {
        registry.ready.set(resourceType, true);
        this.emitChange(clusterId, resourceType, "add", obj);
      });

      informer.on("update", (obj: KubernetesObject) => {
        registry.ready.set(resourceType, true);
        this.emitChange(clusterId, resourceType, "update", obj);
      });

      informer.on("delete", (obj: KubernetesObject) => {
        this.emitChange(clusterId, resourceType, "delete", obj);
      });

      informer.on("error", (err: unknown) => {
        this.logger.debug(
          `[Informer Error] ${clusterId}/${resourceType}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      registry.informers.set(resourceType, informer);

      // 백그라운드 비동기 시작 (초기 List 및 Watch 스트림 수립)
      informer.start().catch((err: unknown) => {
        this.logger.debug(
          `[Informer Start Failed] ${clusterId}/${resourceType}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    } catch (err) {
      this.logger.debug(
        `[Informer Init Error] ${clusterId}/${resourceType}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 변경 이벤트를 리스너에게 통지합니다.
   */
  private emitChange(
    clusterId: string,
    resourceType: InformerResourceType,
    eventType: "add" | "update" | "delete",
    obj: KubernetesObject,
  ): void {
    for (const listener of this.changeListeners) {
      try {
        listener(clusterId, resourceType, eventType, obj);
      } catch {
        // 리스너 오류 격리
      }
    }
  }

  /**
   * 리소스 변경 이벤트 구독 리스너를 등록합니다.
   *
   * @param listener 변경 통지 콜백 함수
   * @returns 구독 해제 함수
   */
  onResourceChange(
    listener: (
      clusterId: string,
      resourceType: InformerResourceType,
      eventType: "add" | "update" | "delete",
      obj: KubernetesObject,
    ) => void,
  ): () => void {
    this.changeListeners.push(listener);
    return () => {
      const idx = this.changeListeners.indexOf(listener);
      if (idx !== -1) {
        this.changeListeners.splice(idx, 1);
      }
    };
  }

  /**
   * 리소스 변경 이벤트 구독 리스너를 등록합니다 (onResourceChange 별칭).
   *
   * @param listener 변경 통지 콜백 함수
   * @returns 구독 해제 함수
   */
  registerChangeListener(
    listener: (
      clusterId: string,
      resourceType: InformerResourceType,
      eventType: "add" | "update" | "delete",
      obj: KubernetesObject,
    ) => void,
  ): () => void {
    return this.onResourceChange(listener);
  }

  /**
   * 특정 클러스터의 Informer가 활성화되어 있고 초기 캐시가 준비되었는지 확인합니다.
   */
  isInformerReady(
    clusterId: string,
    resourceType: InformerResourceType,
  ): boolean {
    const registry = this.registries.get(clusterId);
    if (!registry) return false;
    const informer = registry.informers.get(resourceType);
    if (!informer) return false;
    return (
      registry.ready.get(resourceType) === true || informer.list().length > 0
    );
  }

  /**
   * In-Memory 캐시에서 네임스페이스별 또는 전체 PolicyReport 목록을 반환합니다.
   * 캐시가 준비되지 않은 경우 null을 반환하여 Adapter가 직접 API를 호출하도록 위임합니다.
   */
  listNamespacedPolicyReports(
    clusterId: string,
    namespace?: string,
  ): KubernetesObject[] | null {
    const registry = this.registries.get(clusterId);
    if (!registry) return null;
    const informer = registry.informers.get("policyreports");
    if (!informer) return null;

    if (!this.isInformerReady(clusterId, "policyreports")) {
      return null;
    }

    return (
      namespace ? informer.list(namespace) : informer.list()
    ) as KubernetesObject[];
  }

  /**
   * In-Memory 캐시에서 ClusterPolicyReport 목록을 반환합니다.
   */
  listClusterPolicyReports(clusterId: string): KubernetesObject[] | null {
    const registry = this.registries.get(clusterId);
    if (!registry) return null;
    const informer = registry.informers.get("clusterpolicyreports");
    if (!informer) return null;

    if (!this.isInformerReady(clusterId, "clusterpolicyreports")) {
      return null;
    }

    return informer.list() as KubernetesObject[];
  }

  /**
   * In-Memory 캐시에서 ClusterPolicy 목록을 반환합니다.
   */
  listClusterPolicies(clusterId: string): KubernetesObject[] | null {
    const registry = this.registries.get(clusterId);
    if (!registry) return null;
    const informer = registry.informers.get("clusterpolicies");
    if (!informer) return null;

    if (!this.isInformerReady(clusterId, "clusterpolicies")) {
      return null;
    }

    return informer.list() as KubernetesObject[];
  }

  /**
   * In-Memory 캐시에서 단건 ClusterPolicy를 조회합니다.
   */
  getClusterPolicy(
    clusterId: string,
    name: string,
  ): KubernetesObject | null | undefined {
    const registry = this.registries.get(clusterId);
    if (!registry) return undefined;
    const informer = registry.informers.get("clusterpolicies");
    if (!informer || !this.isInformerReady(clusterId, "clusterpolicies")) {
      return undefined;
    }

    const item = informer.get(name);
    return item ?? null;
  }

  /**
   * In-Memory 캐시에서 PolicyException 목록을 반환합니다.
   */
  listPolicyExceptions(
    clusterId: string,
    namespace?: string,
  ): KubernetesObject[] | null {
    const registry = this.registries.get(clusterId);
    if (!registry) return null;
    const informer = registry.informers.get("policyexceptions");
    if (!informer) return null;

    if (!this.isInformerReady(clusterId, "policyexceptions")) {
      return null;
    }

    return (
      namespace ? informer.list(namespace) : informer.list()
    ) as KubernetesObject[];
  }

  /**
   * In-Memory 캐시에서 단건 PolicyException을 조회합니다.
   */
  getPolicyException(
    clusterId: string,
    name: string,
    namespace?: string,
  ): KubernetesObject | null | undefined {
    const registry = this.registries.get(clusterId);
    if (!registry) return undefined;
    const informer = registry.informers.get("policyexceptions");
    if (!informer || !this.isInformerReady(clusterId, "policyexceptions")) {
      return undefined;
    }

    const item = namespace ? informer.get(name, namespace) : informer.get(name);
    return item ?? null;
  }
}
