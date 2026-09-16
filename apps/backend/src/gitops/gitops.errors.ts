import { HttpStatus } from "@nestjs/common";
import type { BusinessErrorDefinition } from "../common/errors/business-error";

/**
 * GitOps 거버넌스 도메인 비즈니스 에러 카탈로그
 */
export const GITOPS_ERROR = {
  PR_REVIEW_FAILED: {
    code: "GITOPS_PR_REVIEW_FAILED",
    message:
      "GitOps PR 리뷰 거버넌스 검증 수행 중 예기치 않은 오류가 발생했습니다.",
  },
  INVALID_MANIFEST: {
    code: "GITOPS_INVALID_MANIFEST",
    message:
      "제공된 쿠버네티스 매니페스트 YAML 형식이 올바르지 않거나 구문 오류가 있습니다.",
  },
  GITHUB_API_ERROR: {
    code: "GITOPS_GITHUB_API_ERROR",
    message:
      "GitHub API 통신에 실패했습니다. 토큰 권한, API Rate Limit 또는 저장소 설정을 확인하세요.",
  },
  UNAUTHORIZED_CI_TOKEN: {
    code: "GITOPS_UNAUTHORIZED_CI_TOKEN",
    message: "제공된 CI API Key 또는 Webhook Secret이 유효하지 않습니다.",
  },
  CLUSTER_NOT_FOUND: {
    code: "GITOPS_CLUSTER_NOT_FOUND",
    message:
      "지정된 대상 클러스터를 찾을 수 없거나 연동 설정이 되어 있지 않습니다.",
  },
  QUEUE_UNAVAILABLE: {
    code: "GITOPS_009",
    message:
      "PR 리뷰 작업 큐 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 재시도하십시오.",
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
