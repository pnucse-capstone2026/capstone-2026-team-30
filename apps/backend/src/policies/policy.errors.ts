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
  ALREADY_EXISTS: {
    code: "POLICY_ALREADY_EXISTS",
    message: "A policy with the same name already exists in the cluster.",
  },
  INVALID_SPEC: {
    code: "POLICY_INVALID_SPEC",
    message: "The provided Kyverno policy specification is invalid.",
  },
  CREATE_FAILED: {
    code: "POLICY_CREATE_FAILED",
    message: "Failed to create Kyverno policy in Kubernetes cluster.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
