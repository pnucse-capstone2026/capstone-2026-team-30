import { requestWithAuth } from "@/lib/api-client";
import { ClusterMetadata } from "@/lib/clusters";

export type LiveNodeInfo = {
  name: string;
  status: "Ready" | "NotReady" | "Unknown";
  roles: string[];
  kubeletVersion: string;
  osImage: string;
  cpuCapacity: string;
  memoryCapacity: string;
  cpuAllocatable: string;
  memoryAllocatable: string;
  podCount: number;
};

export type LivePodContainer = {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  privileged: boolean;
  requests?: { cpu?: string; memory?: string };
  limits?: { cpu?: string; memory?: string; gpu?: string };
};

export type LivePodViolation = {
  policyName: string;
  ruleName: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
};

export type LivePodException = {
  id: string;
  policyName: string;
  ruleNames: string[];
  reason: string;
  expiresAt: string;
  status: string;
  k8sExceptionName: string;
};

export type LivePodInfo = {
  id: string;
  name: string;
  namespace: string;
  nodeName: string;
  status:
    | "Running"
    | "Pending"
    | "Failed"
    | "Succeeded"
    | "CrashLoopBackOff"
    | "Unknown";
  ready: string; // e.g. "1/1"
  restarts: number;
  podIp: string;
  age: string;
  createdAt: string;
  containers: LivePodContainer[];
  labels: Record<string, string>;
  violations: LivePodViolation[];
  activeExceptions: LivePodException[];
};

export type LiveNamespaceInfo = {
  name: string;
  status: string;
  isSystem: boolean;
  isGovernanceTarget: boolean;
  podCount: number;
  runningPodCount: number;
  violationPodCount: number;
  exceptionPodCount: number;
};

export type LivePolicySummary = {
  name: string;
  mode: "enforce" | "audit";
  type: string;
  ruleCount: number;
  rules: string[];
  description: string;
};

export type LivePolicyExceptionSummary = {
  id: string;
  k8sExceptionName: string;
  policyName: string;
  ruleNames: string[];
  resourceKind: string;
  resourceName: string;
  resourceNamespace: string;
  reason: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  syncedToK8s: boolean;
};

export type LiveClusterOverview = {
  cluster: ClusterMetadata;
  serverVersion: string;
  status: "healthy" | "warning" | "error";
  fetchedAt: string;
  summary: {
    totalNodes: number;
    readyNodes: number;
    totalNamespaces: number;
    totalPods: number;
    runningPods: number;
    pendingPods: number;
    failedPods: number;
    totalPolicies: number;
    enforcePolicies: number;
    auditPolicies: number;
    totalViolations: number;
    violatingPodsCount: number;
    activeExceptionsCount: number;
  };
  nodes: LiveNodeInfo[];
  namespaces: LiveNamespaceInfo[];
  pods: LivePodInfo[];
  policies: LivePolicySummary[];
  exceptions: LivePolicyExceptionSummary[];
};

/**
 * 백엔드 K8s API로부터 실시간 클러스터 상세 현황을 조회합니다.
 */
export async function getLiveClusterOverview(
  clusterId?: string,
): Promise<LiveClusterOverview> {
  const path = clusterId
    ? `/clusters/${encodeURIComponent(clusterId)}/live-overview`
    : `/clusters/live-overview`;
  return requestWithAuth<LiveClusterOverview>(path);
}
