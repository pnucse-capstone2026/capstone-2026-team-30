import { Injectable, Logger } from "@nestjs/common";
import { CoreV1Api, VersionApi } from "@kubernetes/client-node";
import { ExceptionStatus } from "@prisma/client";
import { ClusterProvider, ClusterMetadata } from "./cluster-provider";
import { KyvernoAdapter } from "./kyverno.adapter";
import { PrismaService } from "../prisma/prisma.service";

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
 * Kubernetes 클러스터의 실시간 상태(노드, 네임스페이스, 파드, 정책, 위반 현황)를
 * K8s API로부터 직접 조회하여 상세 관제 데이터를 제공하는 서비스
 */
@Injectable()
export class ClusterOverviewService {
  private readonly logger = new Logger(ClusterOverviewService.name);

  constructor(
    private readonly clusterProvider: ClusterProvider,
    private readonly kyvernoAdapter: KyvernoAdapter,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 지정된 클러스터의 전체 실시간 토폴로지 및 파드/노드/정책 현황을 수집합니다.
   *
   * @param clusterId 대상 클러스터 ID (생략 시 기본 클러스터)
   * @returns 클러스터 실시간 현황 DTO
   */
  async getLiveOverview(clusterId?: string): Promise<LiveClusterOverview> {
    const targetClusterId =
      clusterId || this.clusterProvider.list()[0]?.id || "k8s-lab";
    const clusterMeta = this.clusterProvider.getMetadata(targetClusterId);
    const kubeConfig = this.clusterProvider.getKubeConfig(targetClusterId);

    const coreV1 = kubeConfig.makeApiClient(CoreV1Api);
    const versionApi = kubeConfig.makeApiClient(VersionApi);

    let serverVersion = "v1.36.1";
    try {
      const v = await versionApi.getCode();
      serverVersion = v.gitVersion || `${v.major}.${v.minor}`;
    } catch {
      // ignore
    }

    // 1. 노드, 네임스페이스, 파드, 정책, 위반 리포트, PolicyException CRD, DB 승인 예외 병렬 조회
    const [
      nodesRes,
      namespacesRes,
      podsRes,
      clusterPoliciesRes,
      namespacedReportsRes,
      clusterReportsRes,
      k8sExceptionsRes,
      dbExceptions,
    ] = await Promise.allSettled([
      coreV1.listNode(),
      coreV1.listNamespace(),
      coreV1.listPodForAllNamespaces(),
      this.kyvernoAdapter.listClusterPolicies(targetClusterId),
      this.kyvernoAdapter.listNamespacedPolicyReports(targetClusterId),
      this.kyvernoAdapter.listClusterPolicyReports(targetClusterId),
      this.kyvernoAdapter.listPolicyExceptions(targetClusterId),
      this.prisma.policyExceptionRequest.findMany({
        where: {
          targetClusterId,
          status: { in: [ExceptionStatus.APPROVED, ExceptionStatus.APPLYING] },
        },
      }),
    ]);

    // 2. K8s PolicyException CRD 및 DB 승인 목록 파싱
    const activeDbExceptions =
      dbExceptions.status === "fulfilled" ? dbExceptions.value : [];
    const k8sExceptionList =
      k8sExceptionsRes.status === "fulfilled" ? k8sExceptionsRes.value : [];
    const k8sExceptionNames = new Set(
      k8sExceptionList.map(
        (obj) => (obj as { metadata?: { name?: string } }).metadata?.name,
      ),
    );

    const exceptionsSummary: LivePolicyExceptionSummary[] =
      activeDbExceptions.map((ex) => ({
        id: ex.id,
        k8sExceptionName: ex.k8sExceptionName,
        policyName: ex.policyName,
        ruleNames:
          ex.appliedRuleNames.length > 0 ? ex.appliedRuleNames : ex.ruleNames,
        resourceKind: ex.resourceKind,
        resourceName: ex.resourceName,
        resourceNamespace: ex.resourceNamespace ?? "cluster-wide",
        reason: ex.reason,
        status: ex.status,
        expiresAt: ex.expiresAt.toISOString(),
        createdAt: ex.createdAt.toISOString(),
        syncedToK8s: k8sExceptionNames.has(ex.k8sExceptionName),
      }));

    // 3. 파드별 예외 매핑 테이블 구축
    const podExceptionsMap = new Map<string, LivePodException[]>();
    for (const ex of activeDbExceptions) {
      const key = `${ex.resourceNamespace || "default"}/${ex.resourceName}`;
      const existing = podExceptionsMap.get(key) ?? [];
      existing.push({
        id: ex.id,
        policyName: ex.policyName,
        ruleNames:
          ex.appliedRuleNames.length > 0 ? ex.appliedRuleNames : ex.ruleNames,
        reason: ex.reason,
        expiresAt: ex.expiresAt.toISOString(),
        status: ex.status,
        k8sExceptionName: ex.k8sExceptionName,
      });
      podExceptionsMap.set(key, existing);
    }

    // 4. 위반 리포트 파싱 및 맵핑 (파드별 위반 색인)
    const podViolationsMap = new Map<string, LivePodViolation[]>();
    const allReports = [
      ...(namespacedReportsRes.status === "fulfilled"
        ? namespacedReportsRes.value
        : []),
      ...(clusterReportsRes.status === "fulfilled"
        ? clusterReportsRes.value
        : []),
    ];

    let totalViolationCount = 0;
    for (const report of allReports) {
      const rep = report as {
        metadata?: { name?: string; namespace?: string };
        results?: Array<{
          policy?: string;
          rule?: string;
          severity?: string;
          result?: string;
          message?: string;
          resources?: Array<{
            kind?: string;
            name?: string;
            namespace?: string;
          }>;
        }>;
      };

      for (const res of rep.results ?? []) {
        const resultStatus = res.result?.toLowerCase();
        if (
          resultStatus === "fail" ||
          resultStatus === "warn" ||
          resultStatus === "error"
        ) {
          totalViolationCount++;
          const target = res.resources?.[0];
          if (target && target.name) {
            const key = `${target.namespace || rep.metadata?.namespace || "default"}/${target.name}`;
            const existing = podViolationsMap.get(key) ?? [];
            existing.push({
              policyName: res.policy || "unknown-policy",
              ruleName: res.rule || "unknown-rule",
              severity:
                (res.severity?.toLowerCase() as LivePodViolation["severity"]) ||
                "medium",
              message: res.message || "Kyverno policy violation detected.",
            });
            podViolationsMap.set(key, existing);
          }
        }
      }
    }

    // 5. 파드 목록 파싱
    const rawPods =
      podsRes.status === "fulfilled" ? (podsRes.value.items ?? []) : [];
    const pods: LivePodInfo[] = rawPods.map((p) => {
      const ns = p.metadata?.namespace ?? "default";
      const name = p.metadata?.name ?? "unknown-pod";
      const podKey = `${ns}/${name}`;
      const violations = podViolationsMap.get(podKey) ?? [];
      const activeExceptions = podExceptionsMap.get(podKey) ?? [];

      const containerStatuses = p.status?.containerStatuses ?? [];
      const totalContainers = p.spec?.containers?.length ?? 1;
      const readyContainers = containerStatuses.filter((c) => c.ready).length;

      let restarts = 0;
      let isCrashLoop = false;
      for (const cs of containerStatuses) {
        restarts += cs.restartCount ?? 0;
        if (
          cs.state?.waiting?.reason === "CrashLoopBackOff" ||
          cs.state?.waiting?.reason === "Error"
        ) {
          isCrashLoop = true;
        }
      }

      let status: LivePodInfo["status"] = "Running";
      const phase = p.status?.phase;
      if (isCrashLoop) {
        status = "CrashLoopBackOff";
      } else if (phase === "Pending") {
        status = "Pending";
      } else if (phase === "Failed") {
        status = "Failed";
      } else if (phase === "Succeeded") {
        status = "Succeeded";
      } else if (phase === "Running") {
        status = "Running";
      } else {
        status = "Unknown";
      }

      const containers: LivePodContainer[] = (p.spec?.containers ?? []).map(
        (c) => {
          const cs = containerStatuses.find((s) => s.name === c.name);
          const reqs = c.resources?.requests as
            | Record<string, string>
            | undefined;
          const lims = c.resources?.limits as
            | Record<string, string>
            | undefined;

          return {
            name: c.name,
            image: c.image ?? "unknown",
            ready: Boolean(cs?.ready),
            restartCount: cs?.restartCount ?? 0,
            privileged: Boolean(c.securityContext?.privileged),
            requests: reqs
              ? { cpu: reqs["cpu"], memory: reqs["memory"] }
              : undefined,
            limits: lims
              ? {
                  cpu: lims["cpu"],
                  memory: lims["memory"],
                  gpu: lims["nvidia.com/gpu"],
                }
              : undefined,
          };
        },
      );

      const createdTime = p.metadata?.creationTimestamp
        ? new Date(p.metadata.creationTimestamp)
        : new Date();
      const ageMs = Date.now() - createdTime.getTime();
      const ageSec = Math.floor(ageMs / 1000);
      let ageStr = `${ageSec}s`;
      if (ageSec > 3600) {
        ageStr = `${Math.floor(ageSec / 3600)}h ${Math.floor((ageSec % 3600) / 60)}m`;
      } else if (ageSec > 60) {
        ageStr = `${Math.floor(ageSec / 60)}m ${ageSec % 60}s`;
      }

      return {
        id: `${ns}:${name}`,
        name,
        namespace: ns,
        nodeName: p.spec?.nodeName ?? "unassigned",
        status,
        ready: `${readyContainers}/${totalContainers}`,
        restarts,
        podIp: p.status?.podIP ?? "-",
        age: ageStr,
        createdAt: createdTime.toISOString(),
        containers,
        labels: (p.metadata?.labels as Record<string, string>) ?? {},
        violations,
        activeExceptions,
      };
    });

    // 6. 노드 목록 파싱
    const rawNodes =
      nodesRes.status === "fulfilled" ? (nodesRes.value.items ?? []) : [];
    const nodes: LiveNodeInfo[] = rawNodes.map((n) => {
      const conditions = n.status?.conditions ?? [];
      const readyCond = conditions.find((c) => c.type === "Ready");
      const isReady = readyCond?.status === "True";

      const labels = n.metadata?.labels ?? {};
      const roles: string[] = [];
      for (const key of Object.keys(labels)) {
        if (key.startsWith("node-role.kubernetes.io/")) {
          roles.push(key.replace("node-role.kubernetes.io/", ""));
        }
      }
      if (roles.length === 0) roles.push("worker");

      const nodeName = n.metadata?.name ?? "unknown-node";
      const nodePods = pods.filter((p) => p.nodeName === nodeName);

      const capacity = (n.status?.capacity as Record<string, string>) ?? {};
      const allocatable =
        (n.status?.allocatable as Record<string, string>) ?? {};

      return {
        name: nodeName,
        status: isReady ? "Ready" : "NotReady",
        roles,
        kubeletVersion: n.status?.nodeInfo?.kubeletVersion ?? serverVersion,
        osImage: n.status?.nodeInfo?.osImage ?? "Linux",
        cpuCapacity: capacity["cpu"] ?? "4",
        memoryCapacity: capacity["memory"] ?? "8Gi",
        cpuAllocatable: allocatable["cpu"] ?? capacity["cpu"] ?? "4",
        memoryAllocatable: allocatable["memory"] ?? capacity["memory"] ?? "8Gi",
        podCount: nodePods.length,
      };
    });

    // 7. 네임스페이스 파싱
    const rawNamespaces =
      namespacesRes.status === "fulfilled"
        ? (namespacesRes.value.items ?? [])
        : [];
    const systemNs = new Set([
      "kube-system",
      "kyverno",
      "local-path-storage",
      "kube-public",
      "kube-node-lease",
    ]);

    const namespaces: LiveNamespaceInfo[] = rawNamespaces.map((ns) => {
      const nsName = ns.metadata?.name ?? "default";
      const nsPods = pods.filter((p) => p.namespace === nsName);
      const runningCount = nsPods.filter((p) => p.status === "Running").length;
      const violatingCount = nsPods.filter(
        (p) => p.violations.length > 0,
      ).length;
      const exceptionCount = nsPods.filter(
        (p) => p.activeExceptions.length > 0,
      ).length;

      return {
        name: nsName,
        status: ns.status?.phase ?? "Active",
        isSystem: systemNs.has(nsName),
        isGovernanceTarget: !systemNs.has(nsName),
        podCount: nsPods.length,
        runningPodCount: runningCount,
        violationPodCount: violatingCount,
        exceptionPodCount: exceptionCount,
      };
    });

    // 8. 정책 목록 파싱
    const rawPolicies =
      clusterPoliciesRes.status === "fulfilled" ? clusterPoliciesRes.value : [];
    const policies: LivePolicySummary[] = rawPolicies.map((p) => {
      const raw = p as {
        metadata?: { name?: string; annotations?: Record<string, string> };
        spec?: {
          validationFailureAction?: string;
          rules?: Array<{
            name?: string;
            validate?: unknown;
            mutate?: unknown;
            generate?: unknown;
          }>;
        };
      };
      const name = raw.metadata?.name ?? "unnamed-policy";
      const action = raw.spec?.validationFailureAction?.toLowerCase();
      const mode: LivePolicySummary["mode"] =
        action === "enforce" ? "enforce" : "audit";
      const rules = raw.spec?.rules ?? [];
      const ruleNames = rules
        .map((r) => r.name)
        .filter((n): n is string => Boolean(n));

      let type = "validate";
      if (rules.some((r) => Boolean(r.mutate))) type = "mutate";
      else if (rules.some((r) => Boolean(r.generate))) type = "generate";

      const desc =
        raw.metadata?.annotations?.["policies.kyverno.io/description"] ||
        raw.metadata?.annotations?.["policies.kyverno.io/title"] ||
        `${name} Kyverno Policy`;

      return {
        name,
        mode,
        type,
        ruleCount: ruleNames.length,
        rules: ruleNames,
        description: desc,
      };
    });

    const readyNodesCount = nodes.filter((n) => n.status === "Ready").length;
    const runningPodsCount = pods.filter((p) => p.status === "Running").length;
    const pendingPodsCount = pods.filter((p) => p.status === "Pending").length;
    const failedPodsCount = pods.filter(
      (p) => p.status === "Failed" || p.status === "CrashLoopBackOff",
    ).length;
    const violatingPodsCount = pods.filter(
      (p) => p.violations.length > 0,
    ).length;

    const enforcePoliciesCount = policies.filter(
      (p) => p.mode === "enforce",
    ).length;
    const auditPoliciesCount = policies.filter(
      (p) => p.mode === "audit",
    ).length;

    return {
      cluster: clusterMeta,
      serverVersion,
      status: failedPodsCount > 0 ? "warning" : "healthy",
      fetchedAt: new Date().toISOString(),
      summary: {
        totalNodes: nodes.length,
        readyNodes: readyNodesCount,
        totalNamespaces: namespaces.length,
        totalPods: pods.length,
        runningPods: runningPodsCount,
        pendingPods: pendingPodsCount,
        failedPods: failedPodsCount,
        totalPolicies: policies.length,
        enforcePolicies: enforcePoliciesCount,
        auditPolicies: auditPoliciesCount,
        totalViolations: totalViolationCount,
        violatingPodsCount,
        activeExceptionsCount: activeDbExceptions.length,
      },
      nodes,
      namespaces,
      pods,
      policies,
      exceptions: exceptionsSummary,
    };
  }
}
