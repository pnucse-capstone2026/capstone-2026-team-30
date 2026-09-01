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
  SESSION_EXPIRED: {
    code: "AUTH_SESSION_EXPIRED",
    message:
      "다른 환경에서 로그인되어 세션이 만료되었습니다. 다시 로그인해 주세요.",
  },
  INSUFFICIENT_PERMISSIONS: {
    code: "AUTH_INSUFFICIENT_PERMISSIONS",
    message: "Insufficient permissions.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
