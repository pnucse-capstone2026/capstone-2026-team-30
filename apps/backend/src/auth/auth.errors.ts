import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const AUTH_ERROR = {
  INVALID_CREDENTIALS: {
    code: "AUTH_INVALID_CREDENTIALS",
    message: "Invalid credentials.",
  },
  INVALID_REFRESH_TOKEN: {
    code: "AUTH_INVALID_REFRESH_TOKEN",
    message: "Invalid refresh token.",
  },
  AUTHENTICATION_REQUIRED: {
    code: "AUTHENTICATION_REQUIRED",
    message: "Unauthorized",
  },
  INSUFFICIENT_PERMISSIONS: {
    code: "AUTH_INSUFFICIENT_PERMISSIONS",
    message: "Insufficient permissions.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
