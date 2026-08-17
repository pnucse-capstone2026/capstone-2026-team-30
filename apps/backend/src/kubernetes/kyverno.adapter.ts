import { Injectable } from "@nestjs/common";
import { ClusterProvider } from "./cluster-provider";
import {
  buildPolicyExceptionManifest,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  PolicyExceptionManifestInput,
  REQUEST_ID_LABEL,
} from "./policy-exception-manifest";

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
   * 대상 클러스터의 모든 ClusterPolicy(클러스터 전체 범위 정책) 목록을 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @returns ClusterPolicy K8s 리소스 객체 배열
   */
  async listClusterPolicies(clusterId: string): Promise<KubeObject[]> {
    const connection = this.clusters.get(clusterId);
    try {
      const response = (await connection.customObjectsApi.listClusterCustomObject({
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
        response = (await connection.customObjectsApi.listNamespacedCustomObject({
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
      const response = (await connection.customObjectsApi.listClusterCustomObject({
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
        response = (await connection.customObjectsApi.listNamespacedCustomObject({
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
}
