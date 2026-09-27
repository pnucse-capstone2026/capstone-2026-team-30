import { requestWithAuth } from "@/lib/api-client";

export type ClusterEnvironment =
  | "production"
  | "staging"
  | "development"
  | "sandbox";
export type ClusterStatus = "healthy" | "syncing" | "warning";
export type KyvernoStatus = "ready" | "syncing" | "degraded";

export type ClusterMetadata = {
  id: string;
  displayName: string;
  exceptionNamespace: string;
  gitopsRepo?: string;
  gitopsBranch?: string;
  gitopsPath?: string;
};

/**
 * 로그인한 사용자가 접근 권한을 가진 클러스터 목록을 조회합니다.
 */
export function listClusters() {
  return requestWithAuth<ClusterMetadata[]>("/clusters");
}

/**
 * 전체 클러스터 카탈로그 목록을 조회합니다. (관리자 권한 필요)
 */
export function listClusterCatalog() {
  return requestWithAuth<ClusterMetadata[]>("/clusters/catalog");
}

/**
 * 지정된 ID를 가진 클러스터의 메타데이터를 조회합니다.
 *
 * @param id 클러스터 고유 식별자
 */
export function getCluster(id: string) {
  return requestWithAuth<ClusterMetadata>(`/clusters/${id}`);
}

export type ManagedCluster = {
  id: string;
  name: string;
  environment: ClusterEnvironment;
  region: string;
  provider: "EKS";
  status: ClusterStatus;
  kyvernoStatus: KyvernoStatus;
  nodeCount: number;
  namespaceCount: number;
  policyCount: number;
  violationCount: number;
  lastSyncedAt: string;
  owner?: string;
  exceptionNamespace?: string;
  description: string;
};

export const clusters: ManagedCluster[] = [];

export const clusterEnvironmentLabel: Record<ClusterEnvironment, string> = {
  production: "운영",
  staging: "스테이징",
  development: "개발",
  sandbox: "샌드박스",
};

export const clusterStatusLabel: Record<ClusterStatus, string> = {
  healthy: "정상",
  syncing: "동기화 중",
  warning: "주의",
};

export const kyvernoStatusLabel: Record<KyvernoStatus, string> = {
  ready: "준비됨",
  syncing: "동기화 중",
  degraded: "점검 필요",
};

export const clusterStatusClassName: Record<ClusterStatus, string> = {
  healthy: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  syncing: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
};

export const kyvernoStatusClassName: Record<KyvernoStatus, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  syncing: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  degraded: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
};
