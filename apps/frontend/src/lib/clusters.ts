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
};

export function listClusters() {
  return requestWithAuth<ClusterMetadata[]>("/clusters");
}

export function listClusterCatalog() {
  return requestWithAuth<ClusterMetadata[]>("/clusters/catalog");
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
  owner: string;
  description: string;
};

export const clusters: ManagedCluster[] = [
  {
    id: "production",
    name: "production",
    environment: "production",
    region: "ap-northeast-2",
    provider: "EKS",
    status: "healthy",
    kyvernoStatus: "ready",
    nodeCount: 8,
    namespaceCount: 18,
    policyCount: 2,
    violationCount: 2,
    lastSyncedAt: "2026-07-08 11:45",
    owner: "플랫폼팀",
    description: "실제 사용자 트래픽을 처리하는 운영 유사 클러스터입니다.",
  },
  {
    id: "staging",
    name: "staging",
    environment: "staging",
    region: "ap-northeast-2",
    provider: "EKS",
    status: "healthy",
    kyvernoStatus: "ready",
    nodeCount: 4,
    namespaceCount: 10,
    policyCount: 1,
    violationCount: 1,
    lastSyncedAt: "2026-07-08 11:32",
    owner: "플랫폼팀",
    description: "운영 배포 전 정책과 예외 흐름을 검증하는 클러스터입니다.",
  },
  {
    id: "development",
    name: "development",
    environment: "development",
    region: "ap-northeast-2",
    provider: "EKS",
    status: "healthy",
    kyvernoStatus: "syncing",
    nodeCount: 3,
    namespaceCount: 12,
    policyCount: 2,
    violationCount: 1,
    lastSyncedAt: "2026-07-08 11:10",
    owner: "개발플랫폼팀",
    description: "개발 단계 워크로드와 정책 초안을 검증하는 클러스터입니다.",
  },
  {
    id: "sandbox",
    name: "sandbox",
    environment: "sandbox",
    region: "ap-northeast-2",
    provider: "EKS",
    status: "syncing",
    kyvernoStatus: "syncing",
    nodeCount: 2,
    namespaceCount: 6,
    policyCount: 1,
    violationCount: 0,
    lastSyncedAt: "2026-07-08 10:58",
    owner: "교육지원팀",
    description: "교육과 실습을 위한 격리된 테스트 클러스터입니다.",
  },
];

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
