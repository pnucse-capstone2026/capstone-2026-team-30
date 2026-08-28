import { readFileSync } from "node:fs";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { KubeConfig } from "@kubernetes/client-node";
import { BusinessException } from "../common/errors/business.exception";
import {
  createCustomObjectsApi,
  resolveRequestTimeoutMs,
} from "./custom-objects-api.factory";
import {
  ClusterConfigEntry,
  parseClusterConfig,
} from "./cluster-config.schema";
import {
  ClusterConnection,
  ClusterMetadata,
  ClusterProvider,
} from "./cluster-provider";
import { KUBERNETES_ERROR } from "./kubernetes.errors";

@Injectable()
export class MultiClusterProvider extends ClusterProvider {
  private readonly entries: Map<string, ClusterConfigEntry>;
  private readonly connections = new Map<string, ClusterConnection>();
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService) {
    super();

    const raw = this.loadRawConfig(config);
    const parsed = parseClusterConfig(raw);
    this.entries = new Map(parsed.map((entry) => [entry.id, entry]));
    this.requestTimeoutMs = resolveRequestTimeoutMs(
      config.get<string>("KUBERNETES_REQUEST_TIMEOUT_MS"),
    );
  }

  get(clusterId: string): ClusterConnection {
    const cached = this.connections.get(clusterId);
    if (cached) return cached;

    const entry = this.entries.get(clusterId);
    if (!entry) this.throwNotConfigured(clusterId);

    const connection = this.buildConnection(entry);
    this.connections.set(clusterId, connection);
    return connection;
  }

  getMetadata(clusterId: string): ClusterMetadata {
    const entry = this.entries.get(clusterId);
    if (!entry) this.throwNotConfigured(clusterId);
    return this.toMetadata(entry);
  }

  getDefault(): ClusterConnection {
    const entries = [...this.entries.values()];
    const flagged = entries.filter((entry) => entry.default);
    const target =
      flagged[0] ?? (entries.length === 1 ? entries[0] : undefined);
    if (!target) {
      throw new BusinessException(KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED, {
        message:
          "No default cluster is configured. Mark one cluster with 'default: true'.",
      });
    }
    return this.get(target.id);
  }

  list(): ClusterMetadata[] {
    return [...this.entries.values()].map((entry) => this.toMetadata(entry));
  }

  private toMetadata(entry: ClusterConfigEntry): ClusterMetadata {
    return {
      id: entry.id,
      displayName: entry.displayName ?? entry.id,
      exceptionNamespace: entry.exceptionNamespace,
      gitopsRepo: entry.gitopsRepo,
      gitopsBranch: entry.gitopsBranch,
      gitopsPath: entry.gitopsPath,
    };
  }

  private buildConnection(entry: ClusterConfigEntry): ClusterConnection {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromClusterAndUser(
      {
        name: entry.id,
        server: entry.server,
        caData: entry.caData,
        caFile: entry.caFile,
        skipTLSVerify: entry.skipTLSVerify,
        tlsServerName: entry.tlsServerName,
      },
      {
        name: entry.id,
        token: entry.token,
        certData: entry.clientCertData,
        keyData: entry.clientKeyData,
      },
    );

    return {
      ...this.toMetadata(entry),
      customObjectsApi: createCustomObjectsApi(
        kubeConfig,
        this.requestTimeoutMs,
      ),
    };
  }

  private loadRawConfig(config: ConfigService): unknown {
    const inline = config.get<string>("KUBERNETES_CLUSTERS");
    const filePath = config.get<string>("KUBERNETES_CLUSTERS_FILE");

    let source: string | undefined;
    if (inline && inline.trim()) {
      source = inline;
    } else if (filePath && filePath.trim()) {
      source = readFileSync(filePath.trim(), "utf8");
    }

    if (!source) {
      throw new Error(
        "Multi-cluster mode requires KUBERNETES_CLUSTERS or KUBERNETES_CLUSTERS_FILE to be set.",
      );
    }

    try {
      return JSON.parse(source);
    } catch (error) {
      throw new Error(
        `Failed to parse cluster configuration as JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private throwNotConfigured(clusterId: string): never {
    throw new BusinessException(KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED, {
      message: `Cluster '${clusterId}' is not configured.`,
      context: { clusterId },
    });
  }
}
