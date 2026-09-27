import type { BusinessErrorDefinition } from "../common/errors/business-error";

/**
 * AI Agent 도메인 전용 비즈니스 에러 카탈로그
 */
export const AI_AGENT_ERROR = {
  ANALYSIS_FAILED: {
    code: "AI_AGENT_ANALYSIS_FAILED",
    message: "Failed to perform AI analysis for Kyverno policy rejection.",
  },
  EVALUATION_FAILED: {
    code: "AI_AGENT_EVALUATION_FAILED",
    message: "Failed to evaluate workload scope for AI agent execution.",
  },
  TIMEOUT: {
    code: "AI_AGENT_TIMEOUT",
    message: "AI agent execution request timed out.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
