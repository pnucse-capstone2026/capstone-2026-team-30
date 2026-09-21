export const MANAGED_BY_LABEL = "app.kubernetes.io/managed-by";
export const MANAGED_BY_VALUE = "pac-kyverno-dashboard";
export const REQUEST_ID_LABEL = "pac.kyverno.io/request-id";

export type PolicyExceptionManifestInput = {
  name: string;
  namespace: string;
  requestId: string;
  policyName: string;
  ruleNames: string[];
  resourceKind: string;
  resourceName: string;
  resourceNamespace: string | null;
};

type ResourceMatch = {
  resources: {
    kinds: string[];
    names: string[];
    namespaces?: string[];
  };
};

const POD_CONTROLLERS = new Set([
  "DaemonSet",
  "Deployment",
  "Job",
  "ReplicaSet",
  "ReplicationController",
  "StatefulSet",
]);

function matchFor(
  kind: string,
  name: string,
  namespace: string | null,
): ResourceMatch {
  return {
    resources: {
      kinds: [kind],
      names: [name],
      ...(namespace ? { namespaces: [namespace] } : {}),
    },
  };
}

export function buildPolicyExceptionManifest(
  input: PolicyExceptionManifestInput,
) {
  const any = [
    matchFor(input.resourceKind, input.resourceName, input.resourceNamespace),
  ];

  if (POD_CONTROLLERS.has(input.resourceKind)) {
    any.push(
      matchFor("Pod", `${input.resourceName}-*`, input.resourceNamespace),
    );
  } else if (input.resourceKind === "CronJob") {
    any.push(
      matchFor("Job", `${input.resourceName}-*`, input.resourceNamespace),
    );
    any.push(
      matchFor("Pod", `${input.resourceName}-*`, input.resourceNamespace),
    );
  }

  return {
    apiVersion: "kyverno.io/v2",
    kind: "PolicyException",
    metadata: {
      name: input.name,
      namespace: input.namespace,
      labels: {
        [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
        [REQUEST_ID_LABEL]: input.requestId,
      },
    },
    spec: {
      exceptions: [
        {
          policyName: input.policyName,
          ruleNames: input.ruleNames,
        },
      ],
      match: { any },
    },
  };
}
