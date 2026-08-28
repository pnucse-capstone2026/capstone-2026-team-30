import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KubeConfig } from "@kubernetes/client-node";
import { BusinessException } from "../common/errors/business.exception";
import {
  ClusterConnection,
  ClusterMetadata,
  ClusterProvider,
} from "./cluster-provider";
import {
  createCustomObjectsApi,
  resolveRequestTimeoutMs,
} from "./custom-objects-api.factory";
import { parseKubernetesNamespace } from "./cluster-config.schema";
import { KUBERNETES_ERROR } from "./kubernetes.errors";

@Injectable()
export class SingleClusterProvider extends ClusterProvider {
  private readonly id: string;
  private readonly displayName: string;
  private readonly exceptionNamespace: string;
  private readonly inCluster: boolean;
  private readonly requestTimeoutMs: number;
  private readonly gitopsRepo?: string;
  private readonly gitopsBranch?: string;
  private readonly gitopsPath?: string;
  private connection?: ClusterConnection;

  constructor(config: ConfigService) {
    super();

    this.id = config.get<string>("KUBERNETES_CLUSTER_ID", "default");
    this.displayName = config.get<string>(
      "KUBERNETES_CLUSTER_DISPLAY_NAME",
      this.id,
    );
    this.exceptionNamespace = parseKubernetesNamespace(
      config.get<string>("KUBERNETES_EXCEPTION_NAMESPACE", "kyverno"),
    );
    this.gitopsRepo = config.get<string>("KUBERNETES_GITOPS_REPO");
    this.gitopsBranch = config.get<string>("KUBERNETES_GITOPS_BRANCH");
    this.gitopsPath = config.get<string>("KUBERNETES_GITOPS_PATH");
    this.inCluster = Boolean(config.get<string>("KUBERNETES_SERVICE_HOST"));
    this.requestTimeoutMs = resolveRequestTimeoutMs(
      config.get<string>("KUBERNETES_REQUEST_TIMEOUT_MS"),
    );
  }

  get(clusterId: string): ClusterConnection {
    this.assertCluster(clusterId);
    return this.getDefault();
  }

  getMetadata(clusterId: string): ClusterMetadata {
    this.assertCluster(clusterId);
    return {
      id: this.id,
      displayName: this.displayName,
      exceptionNamespace: this.exceptionNamespace,
      gitopsRepo: this.gitopsRepo,
      gitopsBranch: this.gitopsBranch,
      gitopsPath: this.gitopsPath,
    };
  }

  list(): ClusterMetadata[] {
    return [this.getMetadata(this.id)];
  }

  getDefault(): ClusterConnection {
    if (!this.connection) {
      const kubeConfig = new KubeConfig();
      if (this.inCluster) kubeConfig.loadFromCluster();
      else kubeConfig.loadFromDefault();
      this.connection = {
        id: this.id,
        displayName: this.displayName,
        exceptionNamespace: this.exceptionNamespace,
        gitopsRepo: this.gitopsRepo,
        gitopsBranch: this.gitopsBranch,
        gitopsPath: this.gitopsPath,
        customObjectsApi: createCustomObjectsApi(
          kubeConfig,
          this.requestTimeoutMs,
        ),
      };
    }
    return this.connection;
  }

  private assertCluster(clusterId: string): void {
    if (clusterId !== this.id) {
      throw new BusinessException(KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED, {
        message: `Cluster '${clusterId}' is not configured.`,
        context: { clusterId },
      });
    }
  }
}
