import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const AUDIT_LOG_ERROR = {
  NOT_FOUND: {
    code: "AUDIT_LOG_NOT_FOUND",
    message: "Audit log entry not found.",
  },
  INVALID_DATE_RANGE: {
    code: "AUDIT_LOG_INVALID_DATE_RANGE",
    message: "The start date must be before or equal to the end date.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
