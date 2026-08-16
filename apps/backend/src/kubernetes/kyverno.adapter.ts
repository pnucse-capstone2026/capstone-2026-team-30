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

type KubeObject = {
  metadata?: { labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: {
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
}
