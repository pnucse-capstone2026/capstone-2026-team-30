import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CiOrJwtAuthGuard } from "./guards/ci-or-jwt-auth.guard";
import { GitOpsService } from "./gitops.service";
import {
  GitOpsPrReviewDto,
  GitOpsPrReviewResultDto,
} from "./dto/gitops-pr-review.dto";

/**
 * GitOps 거버넌스 및 Shift-Left PR Gate 컨트롤러
 *
 * 개발자가 생성한 GitHub PR의 변경 매니페스트에 대해 타겟 클러스터의 실제 Kyverno 정책을
 * Server-Side Dry-Run 방식으로 사전 검증하고 결과를 PR Bot 코멘트 및 Commit Status로 자동 반영합니다.
 */
@ApiTags("GitOps Governance")
@ApiBearerAuth()
@ApiHeader({
  name: "X-CI-Token",
  description:
    "CI/CD 파이프라인(GitHub Actions 등) 연동용 Secret 토큰. Bearer JWT 대신 사용 가능합니다.",
  required: false,
})
@UseGuards(CiOrJwtAuthGuard)
@Controller(["v1/gitops", "gitops"])
export class GitOpsController {
  constructor(private readonly gitOpsService: GitOpsService) {}

  /**
   * GitHub Pull Request 매니페스트 변경사항에 대해 Kyverno Server-Side Dry-Run 정책 검증을 수행합니다.
   *
   * @param dto PR 리뷰 검증 요청 데이터 (repository, pullNumber, commitSha, manifestYaml 등)
   * @returns 종합 검증 결과, 차단 여부, 위반 목록, GitHub 코멘트 링크 및 정책 예외 신청 딥링크
   */
  @Post("pr-review")
  @ApiOperation({
    summary: "GitHub PR Server-Side Dry-Run 정책 검증 및 PR Bot 피드백",
    description:
      "PR에서 변경된 쿠버네티스 매니페스트를 타겟 클러스터의 실제 Kyverno 정책과 Server-Side Dry-Run으로 대조합니다. 위반 발생 시 AI 자가 재검증 루프를 통해 교정 diff를 생성하고 PR에 인라인 코멘트와 Commit Status를 게시합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "정책 검증 및 PR 피드백 처리 완료",
    type: GitOpsPrReviewResultDto,
  })
  @ApiResponse({
    status: 400,
    description: "잘못된 요청 파라미터 또는 매니페스트 YAML 구문 오류",
  })
  @ApiResponse({
    status: 401,
    description: "인증 실패 (유효한 JWT 토큰 또는 X-CI-Token 필요)",
  })
  @ApiResponse({
    status: 404,
    description: "지정된 대상 클러스터를 찾을 수 없음",
  })
  async reviewPullRequest(
    @Body() dto: GitOpsPrReviewDto,
  ): Promise<GitOpsPrReviewResultDto> {
    return this.gitOpsService.reviewPullRequest(dto);
  }
}
