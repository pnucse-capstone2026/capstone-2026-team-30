import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const EXCEPTION_REQUEST_ERROR = {
  EXPIRED: {
    code: "EXCEPTION_REQUEST_EXPIRED",
    message: "Exception request has already expired.",
  },
  APPROVED_RULES_INVALID: {
    code: "EXCEPTION_APPROVED_RULES_INVALID",
    message: "Approved rules must be a subset of requested rules.",
  },
  POLICY_NOT_FOUND: {
    code: "POLICY_NOT_FOUND",
    message: "ClusterPolicy not found.",
  },
  POLICY_RULE_VALIDATION_FAILED: {
    code: "POLICY_RULE_VALIDATION_FAILED",
    message: "ClusterPolicy rule validation failed.",
  },
  POLICY_LOOKUP_UNAVAILABLE: {
    code: "POLICY_LOOKUP_UNAVAILABLE",
    message: "Unable to validate the Kyverno policy.",
  },
  SELF_DECISION_FORBIDDEN: {
    code: "EXCEPTION_SELF_DECISION_FORBIDDEN",
    message: "Only an administrator may decide their own exception request.",
  },
  EXPIRATION_MUST_BE_FUTURE: {
    code: "EXCEPTION_EXPIRATION_MUST_BE_FUTURE",
    message: "expiresAt must be in the future.",
  },
  EXPIRATION_TOO_LONG: {
    code: "EXCEPTION_EXPIRATION_TOO_LONG",
    message: "expiresAt exceeds the maximum exception duration.",
  },
  RULE_NAMES_REQUIRED: {
    code: "EXCEPTION_RULE_NAMES_REQUIRED",
    message: "Explicit non-empty rule names are required.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
