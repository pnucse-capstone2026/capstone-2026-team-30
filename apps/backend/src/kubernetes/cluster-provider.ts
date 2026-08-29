import { CustomObjectsApi, KubeConfig } from "@kubernetes/client-node";

export type ClusterConnection = {
  id: string;
  displayName: string;
  exceptionNamespace: string;
  gitopsRepo?: string;
  gitopsBranch?: string;
  gitopsPath?: string;
  customObjectsApi: CustomObjectsApi;
};

export type ClusterMetadata = Omit<ClusterConnection, "customObjectsApi">;

export abstract class ClusterProvider {
  abstract get(clusterId: string): ClusterConnection;
  abstract getDefault(): ClusterConnection;
  abstract getMetadata(clusterId: string): ClusterMetadata;
  abstract list(): ClusterMetadata[];
  abstract getKubeConfig(clusterId: string): KubeConfig;
}
