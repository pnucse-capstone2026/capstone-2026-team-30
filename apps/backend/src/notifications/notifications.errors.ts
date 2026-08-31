import type { BusinessErrorDefinition } from "../common/errors/business-error";

/**
 * 알림 서비스 비즈니스 에러 카탈로그
 */
export const NOTIFICATION_ERROR = {
  NOT_FOUND: {
    code: "NOTIFICATION_NOT_FOUND",
    message: "Target notification was not found.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
