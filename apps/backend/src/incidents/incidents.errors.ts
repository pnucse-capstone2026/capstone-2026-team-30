import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const INCIDENT_ERROR = {
  NOT_FOUND: {
    code: "INCIDENT_NOT_FOUND",
    message: "Target deployment admission incident not found.",
  },
  CLUSTER_ACCESS_DENIED: {
    code: "INCIDENT_CLUSTER_ACCESS_DENIED",
    message: "User does not have access to the specified cluster.",
  },
  ALREADY_RESOLVED: {
    code: "INCIDENT_ALREADY_RESOLVED",
    message: "Target deployment incident is already resolved or ignored.",
  },
  INVALID_STATUS_TRANSITION: {
    code: "INCIDENT_INVALID_STATUS_TRANSITION",
    message: "Cannot transition incident to the requested status.",
  },
  ONLY_ADMIN_ALLOWED: {
    code: "INCIDENT_ADMIN_ONLY",
    message: "Only administrators can perform emergency remediation.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
