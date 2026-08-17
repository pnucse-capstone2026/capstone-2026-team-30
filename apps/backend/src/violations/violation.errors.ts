import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const VIOLATION_ERROR = {
  NOT_FOUND: {
    code: "VIOLATION_NOT_FOUND_IN_CLUSTER",
    message: "Target policy violation report item not found.",
  },
  CLUSTER_ACCESS_DENIED: {
    code: "VIOLATION_CLUSTER_ACCESS_DENIED",
    message: "User does not have access to the specified cluster.",
  },
  REPORT_LOOKUP_FAILED: {
    code: "VIOLATION_REPORT_LOOKUP_FAILED",
    message: "Failed to retrieve PolicyReports from Kubernetes cluster.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
