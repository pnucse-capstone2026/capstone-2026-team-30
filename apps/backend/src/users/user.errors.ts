import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const USER_ERROR = {
  EMAIL_ALREADY_EXISTS: {
    code: "USER_EMAIL_ALREADY_EXISTS",
    message: "User email already exists.",
  },
  NOT_FOUND: {
    code: "USER_NOT_FOUND",
    message: "User not found.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
