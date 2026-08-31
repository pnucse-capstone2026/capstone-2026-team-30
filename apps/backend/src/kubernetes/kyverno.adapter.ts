import { Injectable } from "@nestjs/common";
import { ClusterMetadata, ClusterProvider } from "./cluster-provider";
import {
  buildPolicyExceptionManifest,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  PolicyExceptionManifestInput,
  REQUEST_ID_LABEL,
} from "./policy-exception-manifest";
import { ViolationSummaryDto } from "../violations/dto/violation-summary.dto";

const KYVERNO_GROUP = "kyverno.io";
const POLICY_VERSION = "v1";
const POLICY_PLURAL = "clusterpolicies";
const EXCEPTION_VERSION = "v2beta1";
const EXCEPTION_PLURAL = "policyexceptions";

const WG_POLICY_GROUP = "wgpolicyk8s.io";
const POLICY_REPORT_VERSION = "v1alpha2";
const POLICY_REPORT_PLURAL = "policyreports";
const CLUSTER_POLICY_REPORT_PLURAL = "clusterpolicyreports";

export type KubeObject = {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  status?: {
    ready?: boolean;
    conditions?: Array<{ type?: string; status?: string }>;
    autogen?: {
      rules?: Array<{ name?: string }>;
    };
  };
};

export class PolicyNotFoundError extends Error {}
export class PolicyRuleValidationError extends Error {}
export class PolicyExceptionConflictError extends Error {}

/**
 * `@kubernetes/client-node` 는 실패를 `ApiException` 으로 던지고 HTTP 상태를
 * `code` 로 싣는다. Node 시스템 오류(`ECONNREFUSED` 등)도 `code` 를 갖지만 문자열
 * 이므로, 숫자일 때만 상태로 인정한다.
 */
function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "number" ? code : undefined;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

function normalized(value: unknown): string {
  return JSON.stringify(normalize(value));
}

@Injectable()
export class KyvernoAdapter {
  constructor(private readonly clusters: ClusterProvider) {}

  async resolveRuleNames(
    clusterId: string,
    policyName: string,
    requestedRuleNames: string[],
    resourceKind: string,
  ): Promise<string[]> {
    const ruleNames = [
      ...new Set(requestedRuleNames.map((rule) => rule.trim())),
    ];
    if (
      ruleNames.length === 0 ||
      ruleNames.some((rule) => !rule || rule === "*")
    ) {
      throw new PolicyRuleValidationError(
        "At least one explicit rule name is required.",
      );
    }

    const { customObjectsApi } = this.clusters.get(clusterId);
    let policy: KubeObject;
    try {
      policy = (await customObjectsApi.getClusterCustomObject({
        group: KYVERNO_GROUP,
        version: POLICY_VERSION,
        plural: POLICY_PLURAL,
        name: policyName,
      })) as KubeObject;
    } catch (error) {
      if (statusCode(error) === 404) {
        throw new PolicyNotFoundError(
          `ClusterPolicy '${policyName}' not found.`,
        );
      }
      throw error;
    }

    const baseRules = Array.isArray(policy.spec?.rules)
      ? (policy.spec.rules as Array<{ name?: string }>)
      : [];
    const knownBaseNames = new Set(baseRules.map((rule) => rule.name));
    const missing = ruleNames.filter((rule) => !knownBaseNames.has(rule));
    if (missing.length) {
      throw new PolicyRuleValidationError(
        `Unknown ClusterPolicy rule(s): ${missing.join(", ")}.`,
      );
    }

    const autogenPrefix =
      resourceKind === "CronJob" ? "autogen-cronjob-" : "autogen-";
    const supportsAutogen =
      resourceKind === "CronJob" ||
      [
        "DaemonSet",
        "Deployment",
        "Job",
        "ReplicaSet",
        "ReplicationController",
        "StatefulSet",
      ].includes(resourceKind);
    const generated = new Set(
      (policy.status?.autogen?.rules ?? [])
        .map((rule) => rule.name)
        .filter((name): name is string => Boolean(name)),
    );
    const applied = [...ruleNames];

    if (supportsAutogen) {
      for (const rule of ruleNames) {
        const generatedName = `${autogenPrefix}${rule}`;
        if (generated.has(generatedName)) applied.push(generatedName);
      }
    }

    return applied;
  }

  async ensurePolicyException(
    clusterId: string,
    input: Omit<PolicyExceptionManifestInput, "namespace">,
  ): Promise<void> {
    const connection = this.clusters.get(clusterId);
    const manifest = buildPolicyExceptionManifest({
      ...input,
      namespace: connection.exceptionNamespace,
    });
    const existing = await this.getPolicyException(clusterId, input.name);

    if (existing) {
      const labels = existing.metadata?.labels ?? {};
      const sameOwner =
        labels[MANAGED_BY_LABEL] === MANAGED_BY_VALUE &&
        labels[REQUEST_ID_LABEL] === input.requestId;
      if (
        !sameOwner ||
        normalized(existing.spec) !== normalized(manifest.spec)
      ) {
        throw new PolicyExceptionConflictError(
          `PolicyException '${input.name}' already exists with a different owner or spec.`,
        );
      }
      return;
    }

    await connection.customObjectsApi.createNamespacedCustomObject({
      group: KYVERNO_GROUP,
      version: EXCEPTION_VERSION,
      namespace: connection.exceptionNamespace,
      plural: EXCEPTION_PLURAL,
      body: manifest,
    });
  }

  async getPolicyException(
    clusterId: string,
    name: string,
  ): Promise<KubeObject | null> {
    const connection = this.clusters.get(clusterId);
    try {
      return (await connection.customObjectsApi.getNamespacedCustomObject({
        group: KYVERNO_GROUP,
        version: EXCEPTION_VERSION,
        namespace: connection.exceptionNamespace,
        plural: EXCEPTION_PLURAL,
        name,
      })) as KubeObject;
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }

  async deletePolicyException(clusterId: string, name: string): Promise<void> {
    const connection = this.clusters.get(clusterId);
    try {
      await connection.customObjectsApi.deleteNamespacedCustomObject({
        group: KYVERNO_GROUP,
        version: EXCEPTION_VERSION,
        namespace: connection.exceptionNamespace,
        plural: EXCEPTION_PLURAL,
        name,
      });
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
    }
  }

  /**
   * 대상 클러스터에 신규 ClusterPolicy 리소스를 생성합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param manifest ClusterPolicy K8s 매니페스트 객체
   * @returns 생성된 ClusterPolicy K8s 리소스 객체
   */
  async createClusterPolicy(
    clusterId: string,
    manifest: Record<string, unknown>,
  ): Promise<KubeObject> {
    const connection = this.clusters.get(clusterId);
    const result = await connection.customObjectsApi.createClusterCustomObject({
      group: KYVERNO_GROUP,
      version: POLICY_VERSION,
      plural: POLICY_PLURAL,
      body: manifest,
    });
    return result as KubeObject;
  }

  /**
   * 대상 클러스터의 특정 네임스페이스에 신규 Policy 리소스를 생성합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param namespace 네임스페이스
   * @param manifest Policy K8s 매니페스트 객체
   * @returns 생성된 Policy K8s 리소스 객체
   */
  async createNamespacedPolicy(
    clusterId: string,
    namespace: string,
    manifest: Record<string, unknown>,
  ): Promise<KubeObject> {
    const connection = this.clusters.get(clusterId);
    const result =
      await connection.customObjectsApi.createNamespacedCustomObject({
        group: KYVERNO_GROUP,
        version: POLICY_VERSION,
        namespace,
        plural: "policies",
        body: manifest,
      });
    return result as KubeObject;
  }

  /**
   * 대상 클러스터의 모든 ClusterPolicy(클러스터 전체 범위 정책) 목록을 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @returns ClusterPolicy K8s 리소스 객체 배열
   */
  async listClusterPolicies(clusterId: string): Promise<KubeObject[]> {
    const connection = this.clusters.get(clusterId);
    try {
      const response =
        (await connection.customObjectsApi.listClusterCustomObject({
          group: KYVERNO_GROUP,
          version: POLICY_VERSION,
          plural: POLICY_PLURAL,
        })) as { items?: KubeObject[] };

      return Array.isArray(response?.items) ? response.items : [];
    } catch (error) {
      if (statusCode(error) === 404) return [];
      throw error;
    }
  }

  /**
   * 대상 클러스터의 특정 또는 전체 네임스페이스에 배포된 Policy 목록을 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @param namespace 특정 네임스페이스 (생략 시 클러스터 전체 네임스페이스 대상)
   * @returns Namespaced Policy K8s 리소스 객체 배열
   */
  async listNamespacedPolicies(
    clusterId: string,
    namespace?: string,
  ): Promise<KubeObject[]> {
    const connection = this.clusters.get(clusterId);
    try {
      let response: { items?: KubeObject[] };
      if (namespace) {
        response =
          (await connection.customObjectsApi.listNamespacedCustomObject({
            group: KYVERNO_GROUP,
            version: POLICY_VERSION,
            namespace,
            plural: "policies",
          })) as { items?: KubeObject[] };
      } else {
        response = (await connection.customObjectsApi.listClusterCustomObject({
          group: KYVERNO_GROUP,
          version: POLICY_VERSION,
          plural: "policies",
        })) as { items?: KubeObject[] };
      }

      return Array.isArray(response?.items) ? response.items : [];
    } catch (error) {
      if (statusCode(error) === 404) return [];
      throw error;
    }
  }

  /**
   * 대상 클러스터에서 특정 이름의 ClusterPolicy 단건 상세를 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @param name ClusterPolicy 정책 이름
   * @returns ClusterPolicy K8s 리소스 객체 (미존재 시 null)
   */
  async getClusterPolicy(
    clusterId: string,
    name: string,
  ): Promise<KubeObject | null> {
    const connection = this.clusters.get(clusterId);
    try {
      return (await connection.customObjectsApi.getClusterCustomObject({
        group: KYVERNO_GROUP,
        version: POLICY_VERSION,
        plural: POLICY_PLURAL,
        name,
      })) as KubeObject;
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }

  /**
   * 대상 클러스터에서 특정 네임스페이스의 Policy 단건 상세를 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @param namespace 네임스페이스
   * @param name Policy 정책 이름
   * @returns Policy K8s 리소스 객체 (미존재 시 null)
   */
  async getNamespacedPolicy(
    clusterId: string,
    namespace: string,
    name: string,
  ): Promise<KubeObject | null> {
    const connection = this.clusters.get(clusterId);
    try {
      return (await connection.customObjectsApi.getNamespacedCustomObject({
        group: KYVERNO_GROUP,
        version: POLICY_VERSION,
        namespace,
        plural: "policies",
        name,
      })) as KubeObject;
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }

  /**
   * 대상 클러스터의 모든 ClusterPolicyReport(클러스터 전역 위반 보고서)를 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @returns ClusterPolicyReport 리소스 배열
   */
  async listClusterPolicyReports(clusterId: string): Promise<KubeObject[]> {
    const connection = this.clusters.get(clusterId);
    try {
      const response =
        (await connection.customObjectsApi.listClusterCustomObject({
          group: WG_POLICY_GROUP,
          version: POLICY_REPORT_VERSION,
          plural: CLUSTER_POLICY_REPORT_PLURAL,
        })) as { items?: KubeObject[] };

      return Array.isArray(response?.items) ? response.items : [];
    } catch (error) {
      if (statusCode(error) === 404) return [];
      throw error;
    }
  }

  /**
   * 대상 클러스터의 특정 또는 전체 네임스페이스에 대한 PolicyReport(네임스페이스 범위 위반 보고서)를 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @param namespace 네임스페이스 (생략 시 전체 네임스페이스 대상)
   * @returns PolicyReport 리소스 배열
   */
  async listNamespacedPolicyReports(
    clusterId: string,
    namespace?: string,
  ): Promise<KubeObject[]> {
    const connection = this.clusters.get(clusterId);
    try {
      let response: { items?: KubeObject[] };
      if (namespace) {
        response =
          (await connection.customObjectsApi.listNamespacedCustomObject({
            group: WG_POLICY_GROUP,
            version: POLICY_REPORT_VERSION,
            namespace,
            plural: POLICY_REPORT_PLURAL,
          })) as { items?: KubeObject[] };
      } else {
        response = (await connection.customObjectsApi.listClusterCustomObject({
          group: WG_POLICY_GROUP,
          version: POLICY_REPORT_VERSION,
          plural: POLICY_REPORT_PLURAL,
        })) as { items?: KubeObject[] };
      }

      return Array.isArray(response?.items) ? response.items : [];
    } catch (error) {
      if (statusCode(error) === 404) return [];
      throw error;
    }
  }

  /**
   * 대상 클러스터에서 특정 ClusterPolicyReport 단건을 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @param name ClusterPolicyReport 이름
   * @returns ClusterPolicyReport 리소스 (미존재 시 null)
   */
  async getClusterPolicyReport(
    clusterId: string,
    name: string,
  ): Promise<KubeObject | null> {
    const connection = this.clusters.get(clusterId);
    try {
      return (await connection.customObjectsApi.getClusterCustomObject({
        group: WG_POLICY_GROUP,
        version: POLICY_REPORT_VERSION,
        plural: CLUSTER_POLICY_REPORT_PLURAL,
        name,
      })) as KubeObject;
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }

  /**
   * 대상 클러스터에서 특정 네임스페이스의 PolicyReport 단건을 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @param namespace 네임스페이스
   * @param name PolicyReport 이름
   * @returns PolicyReport 리소스 (미존재 시 null)
   */
  async getNamespacedPolicyReport(
    clusterId: string,
    namespace: string,
    name: string,
  ): Promise<KubeObject | null> {
    const connection = this.clusters.get(clusterId);
    try {
      return (await connection.customObjectsApi.getNamespacedCustomObject({
        group: WG_POLICY_GROUP,
        version: POLICY_REPORT_VERSION,
        namespace,
        plural: POLICY_REPORT_PLURAL,
        name,
      })) as KubeObject;
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }

  /**
   * 특정 클러스터 또는 전체 클러스터에서 네임스페이스 범위 PolicyReport(wgpolicyk8s.io)를 수집하고
   * 정규화된 ViolationSummaryDto DTO 배열로 파싱하여 반환합니다.
   *
   * @param clusterName (선택) 특정 클러스터 ID 또는 표시명
   * @returns 정규화된 정책 위반 요약 DTO 배열
   */
  async getPolicyReports(clusterName?: string): Promise<ViolationSummaryDto[]> {
    // 수집 대상 클러스터 식별자를 추출하여 다중 클러스터 조회를 격리 수행함
    const targetClusters = this.resolveTargetClusters(clusterName);
    const violations: ViolationSummaryDto[] = [];

    for (const cluster of targetClusters) {
      try {
        const rawReports = await this.listNamespacedPolicyReports(cluster.id);
        for (const raw of rawReports) {
          const extracted = this.extractViolationsFromReportObject(
            raw as Record<string, unknown>,
            cluster,
          );
          violations.push(...extracted);
        }
      } catch {
        // 단일 클러스터 조회 실패가 전체 위반 조회를 중단하지 않도록 실패 격리
        continue;
      }
    }

    return violations;
  }

  /**
   * 특정 클러스터 또는 전체 클러스터에서 클러스터 전역 범위 ClusterPolicyReport(wgpolicyk8s.io)를 수집하고
   * 정규화된 ViolationSummaryDto DTO 배열로 파싱하여 반환합니다.
   *
   * @param clusterName (선택) 특정 클러스터 ID 또는 표시명
   * @returns 정규화된 정책 위반 요약 DTO 배열
   */
  async getClusterPolicyReports(
    clusterName?: string,
  ): Promise<ViolationSummaryDto[]> {
    // 수집 대상 클러스터 식별자를 추출하여 다중 클러스터 조회를 격리 수행함
    const targetClusters = this.resolveTargetClusters(clusterName);
    const violations: ViolationSummaryDto[] = [];

    for (const cluster of targetClusters) {
      try {
        const rawReports = await this.listClusterPolicyReports(cluster.id);
        for (const raw of rawReports) {
          const extracted = this.extractViolationsFromReportObject(
            raw as Record<string, unknown>,
            cluster,
          );
          violations.push(...extracted);
        }
      } catch {
        // 특정 클러스터의 API 오류 발생 시 나머지 클러스터 응답성 유지
        continue;
      }
    }

    return violations;
  }

  /**
   * 입력받은 clusterName 인수를 기반으로 검색 대상 클러스터 목록을 반환합니다.
   *
   * @param clusterName 클러스터 식별자 또는 표시명
   * @returns 검색 대상 클러스터 메타데이터 배열
   */
  private resolveTargetClusters(clusterName?: string): ClusterMetadata[] {
    const all = this.clusters.list();
    if (!clusterName) {
      return all;
    }
    return all.filter(
      (c) => c.id === clusterName || c.displayName === clusterName,
    );
  }

  /**
   * raw K8s PolicyReport JSON 리소스 객체에서 fail/warn/error 결과 항목들을 추출 및 정규화합니다.
   *
   * @param report raw PolicyReport K8s 객체
   * @param cluster 클러스터 메타데이터
   * @returns 정규화된 위반 DTO 배열
   */
  private extractViolationsFromReportObject(
    report: Record<string, unknown>,
    cluster: ClusterMetadata,
  ): ViolationSummaryDto[] {
    const metadata = (report.metadata as Record<string, unknown>) ?? {};
    const results = (report.results as Array<Record<string, unknown>>) ?? [];
    const violations: ViolationSummaryDto[] = [];

    results.forEach((result, index) => {
      const outcome = (
        (result.result as string) ||
        (result.status as string) ||
        ""
      ).toLowerCase();

      // fail, warn, error 상태의 검사 결과만 정규화 DTO로 변환
      if (outcome === "fail" || outcome === "warn" || outcome === "error") {
        const reportName = (metadata.name as string) ?? "unknown-report";
        const id = `${cluster.id}:${reportName}:${index}`;
        const policyName = (result.policy as string) ?? "unknown-policy";
        const ruleName = (result.rule as string) ?? "unknown-rule";

        const resources =
          (result.resources as Array<Record<string, unknown>>) ?? [];
        const targetResource = resources[0];
        const resourceKind = (targetResource?.kind as string) ?? "Unknown";
        const resourceName = (targetResource?.name as string) ?? "Unknown";
        const namespace =
          (targetResource?.namespace as string) ??
          (metadata.namespace as string) ??
          "cluster-wide";

        let severity: "critical" | "high" | "medium" | "low" | "info" =
          "medium";
        const rawSev = (result.severity as string)?.toLowerCase();
        if (rawSev === "critical") severity = "critical";
        else if (rawSev === "high") severity = "high";
        else if (rawSev === "low") severity = "low";
        else if (rawSev === "info") severity = "info";

        let detectedAt =
          (metadata.creationTimestamp as string) ?? new Date().toISOString();
        const timestampObj = result.timestamp as
          | { seconds?: number }
          | undefined;
        if (timestampObj?.seconds) {
          detectedAt = new Date(timestampObj.seconds * 1000).toISOString();
        }

        const message =
          (result.message as string) ??
          `Policy '${policyName}' violation detected on ${resourceKind}/${resourceName}.`;

        violations.push({
          id,
          clusterId: cluster.id,
          clusterDisplayName: cluster.displayName,
          namespace,
          policyName,
          ruleName,
          resourceKind,
          resourceName,
          severity,
          status: "open",
          message,
          detectedAt,
          reportName,
        });
      }
    });

    return violations;
  }
}
