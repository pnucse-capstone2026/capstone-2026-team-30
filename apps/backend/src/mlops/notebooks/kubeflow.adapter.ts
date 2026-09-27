import { Injectable } from "@nestjs/common";
import { CoreV1Api, KubeConfig, Watch } from "@kubernetes/client-node";
import { Observable } from "rxjs";
import { ClusterProvider } from "../../kubernetes/cluster-provider";

export const KUBEFLOW_GROUP = "kubeflow.org";
export const KUBEFLOW_VERSION = "v1";
export const KUBEFLOW_NOTEBOOK_PLURAL = "notebooks";

export type KubeflowNotebookStatus = {
  ready?: boolean;
  conditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
  }>;
  containerState?: Record<string, unknown>;
};

export type KubeflowNotebookManifest = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec: {
    template: {
      metadata?: {
        labels?: Record<string, string>;
        annotations?: Record<string, string>;
      };
      spec: {
        containers: Array<{
          name: string;
          image: string;
          resources?: {
            requests?: Record<string, string>;
            limits?: Record<string, string>;
          };
          volumeMounts?: Array<{
            name: string;
            mountPath: string;
          }>;
          env?: Array<{ name: string; value: string }>;
        }>;
        volumes?: Array<{
          name: string;
          persistentVolumeClaim?: {
            claimName: string;
          };
        }>;
      };
    };
  };
  status?: KubeflowNotebookStatus;
};

/**
 * 에러 객체에서 HTTP 상태 코드를 안전하게 추출합니다.
 */
function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "number" ? code : undefined;
}

/**
 * Kubeflow Notebook CRD(`kubeflow.org/v1`) 및 PersistentVolumeClaim과의 직접적인 K8s API 통신을 담당하는 어댑터입니다.
 */
@Injectable()
export class KubeflowAdapter {
  constructor(private readonly clusterProvider: ClusterProvider) {}

  /**
   * CoreV1Api 인스턴스 팩토리 (PVC 조회/생성용)
   */
  private getCoreV1Api(clusterId?: string): CoreV1Api {
    if (clusterId) {
      const kubeConfig = this.clusterProvider.getKubeConfig(clusterId);
      return kubeConfig.makeApiClient(CoreV1Api);
    }
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    return kubeConfig.makeApiClient(CoreV1Api);
  }

  /**
   * 지정된 클러스터 및 네임스페이스의 Kubeflow Notebook 목록을 조회합니다.
   */
  async listNotebooks(
    clusterId: string,
    namespace: string = "default",
  ): Promise<KubeflowNotebookManifest[]> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    try {
      const response = (await customObjectsApi.listNamespacedCustomObject({
        group: KUBEFLOW_GROUP,
        version: KUBEFLOW_VERSION,
        namespace,
        plural: KUBEFLOW_NOTEBOOK_PLURAL,
      })) as
        | { items?: KubeflowNotebookManifest[] }
        | KubeflowNotebookManifest[];

      const items = Array.isArray(response)
        ? response
        : ((response as { items?: KubeflowNotebookManifest[] })?.items ?? []);

      return items;
    } catch (error) {
      if (statusCode(error) === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * 단일 Kubeflow Notebook 상세 정보를 조회합니다.
   */
  async getNotebook(
    clusterId: string,
    namespace: string,
    name: string,
  ): Promise<KubeflowNotebookManifest | null> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    try {
      const response = (await customObjectsApi.getNamespacedCustomObject({
        group: KUBEFLOW_GROUP,
        version: KUBEFLOW_VERSION,
        namespace,
        plural: KUBEFLOW_NOTEBOOK_PLURAL,
        name,
      })) as KubeflowNotebookManifest;

      return response;
    } catch (error) {
      if (statusCode(error) === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 신규 Kubeflow Notebook CRD를 프로비저닝합니다.
   */
  async createNotebook(
    clusterId: string,
    namespace: string,
    manifest: KubeflowNotebookManifest,
  ): Promise<KubeflowNotebookManifest> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    const response = (await customObjectsApi.createNamespacedCustomObject({
      group: KUBEFLOW_GROUP,
      version: KUBEFLOW_VERSION,
      namespace,
      plural: KUBEFLOW_NOTEBOOK_PLURAL,
      body: manifest,
    })) as KubeflowNotebookManifest;

    return response;
  }

  /**
   * Notebook을 중지 상태로 변경합니다. (annotation `kubeflow-resource-stopped: "true"` 부여)
   */
  async stopNotebook(
    clusterId: string,
    namespace: string,
    name: string,
  ): Promise<KubeflowNotebookManifest> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    const patchBody = [
      {
        op: "add",
        path: "/metadata/annotations/kubeflow-resource-stopped",
        value: "true",
      },
    ];

    const response = (await customObjectsApi.patchNamespacedCustomObject({
      group: KUBEFLOW_GROUP,
      version: KUBEFLOW_VERSION,
      namespace,
      plural: KUBEFLOW_NOTEBOOK_PLURAL,
      name,
      body: patchBody,
    })) as KubeflowNotebookManifest;

    return response;
  }

  /**
   * 중지된 Notebook을 재시작합니다. (`kubeflow-resource-stopped` 어노테이션 제거)
   */
  async startNotebook(
    clusterId: string,
    namespace: string,
    name: string,
  ): Promise<KubeflowNotebookManifest> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    const patchBody = [
      {
        op: "remove",
        path: "/metadata/annotations/kubeflow-resource-stopped",
      },
    ];

    try {
      const response = (await customObjectsApi.patchNamespacedCustomObject({
        group: KUBEFLOW_GROUP,
        version: KUBEFLOW_VERSION,
        namespace,
        plural: KUBEFLOW_NOTEBOOK_PLURAL,
        name,
        body: patchBody,
      })) as KubeflowNotebookManifest;

      return response;
    } catch (error) {
      const notebook = await this.getNotebook(clusterId, namespace, name);
      if (!notebook) throw error;
      return notebook;
    }
  }

  /**
   * Kubeflow Notebook 인스턴스를 삭제합니다.
   */
  async deleteNotebook(
    clusterId: string,
    namespace: string,
    name: string,
  ): Promise<void> {
    const { customObjectsApi } = this.clusterProvider.get(clusterId);

    await customObjectsApi.deleteNamespacedCustomObject({
      group: KUBEFLOW_GROUP,
      version: KUBEFLOW_VERSION,
      namespace,
      plural: KUBEFLOW_NOTEBOOK_PLURAL,
      name,
    });
  }

  /**
   * 노트북 사용자 홈 디렉토리 마운트용 PVC가 존재하는지 검증하고, 없으면 새로 생성합니다.
   */
  async ensureWorkspacePvc(
    clusterId: string,
    namespace: string,
    pvcName: string,
    storageGb: number,
  ): Promise<void> {
    const coreApi = this.getCoreV1Api(clusterId);

    try {
      await coreApi.readNamespacedPersistentVolumeClaim({
        name: pvcName,
        namespace,
      });
      return;
    } catch (error) {
      if (statusCode(error) !== 404) {
        throw error;
      }
    }

    await coreApi.createNamespacedPersistentVolumeClaim({
      namespace,
      body: {
        apiVersion: "v1",
        kind: "PersistentVolumeClaim",
        metadata: {
          name: pvcName,
          namespace,
          labels: {
            "app.kubernetes.io/component": "mlops-notebook-storage",
          },
        },
        spec: {
          accessModes: ["ReadWriteOnce"],
          resources: {
            requests: {
              storage: `${storageGb}Gi`,
            },
          },
        },
      },
    });
  }

  /**
   * Kubernetes Custom Objects Watch API(`kubeflow.org/v1`, plural: `notebooks`)를 사용하여
   * 지정된 클러스터 및 네임스페이스의 Notebook 변경 이벤트(`ADDED`, `MODIFIED`, `DELETED`)를 감지하는 Observable 스트림을 생성합니다.
   *
   * @param clusterId 감지 대상 클러스터 ID
   * @param namespace 감지 대상 네임스페이스
   */
  watchNotebooks(
    clusterId: string,
    namespace: string = "default",
  ): Observable<{ type: string; object: KubeflowNotebookManifest }> {
    return new Observable((subscriber) => {
      let watchRequest: { abort?: () => void; destroy?: () => void } | null =
        null;

      try {
        const kubeConfig = this.clusterProvider.getKubeConfig(clusterId);
        const watch = new Watch(kubeConfig);
        const path = `/apis/${KUBEFLOW_GROUP}/${KUBEFLOW_VERSION}/namespaces/${namespace}/${KUBEFLOW_NOTEBOOK_PLURAL}`;

        watch
          .watch(
            path,
            {},
            (type, apiObj) => {
              subscriber.next({
                type,
                object: apiObj as KubeflowNotebookManifest,
              });
            },
            (err) => {
              if (err) {
                subscriber.error(err);
              } else {
                subscriber.complete();
              }
            },
          )
          .then((req) => {
            watchRequest = req as { abort?: () => void; destroy?: () => void };
          })
          .catch((err) => {
            subscriber.error(err);
          });
      } catch (err) {
        subscriber.error(err);
      }

      return () => {
        if (watchRequest) {
          if (typeof watchRequest.abort === "function") {
            watchRequest.abort();
          } else if (typeof watchRequest.destroy === "function") {
            watchRequest.destroy();
          }
        }
      };
    });
  }
}
