import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const EXCEPTION_LIFECYCLE_ERROR = {
  REQUEST_NOT_FOUND: {
    code: "EXCEPTION_REQUEST_NOT_FOUND",
    message: "Exception request not found.",
  },
  INVALID_TRANSITION: {
    code: "EXCEPTION_INVALID_TRANSITION",
    message: "Exception request cannot transition to the requested status.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
