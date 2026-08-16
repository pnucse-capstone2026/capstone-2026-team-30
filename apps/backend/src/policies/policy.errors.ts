import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const POLICY_ERROR = {
  NOT_FOUND: {
    code: "POLICY_NOT_FOUND_IN_CLUSTER",
    message: "Target Kyverno policy not found in cluster.",
  },
  CLUSTER_ACCESS_DENIED: {
    code: "POLICY_CLUSTER_ACCESS_DENIED",
    message: "User does not have access to the specified cluster.",
  },
  LOOKUP_FAILED: {
    code: "POLICY_LOOKUP_FAILED",
    message: "Failed to retrieve Kyverno policies from Kubernetes cluster.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
