import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CiOrJwtAuthGuard } from "./guards/ci-or-jwt-auth.guard";
import {
  GitOpsPrReviewAsyncResponseDto,
  GitOpsPrReviewDto,
} from "./dto/gitops-pr-review.dto";
import { GitOpsPrReviewQueue } from "./queues/gitops-pr-review.queue";
import {
  VCS_PROVIDER_TOKEN,
  VcsProvider,
} from "./providers/vcs-provider.interface";

/**
 * GitOps 거버넌스 및 Shift-Left PR Gate 컨트롤러
 *
 * 개발자가 생성한 GitHub PR의 변경 매니페스트에 대해 BullMQ 작업 큐에 비동기 위임하여
 * AWS Bedrock 및 GitHub API Quota를 보호하며, GitHub Check Run 라이프사이클과 연동합니다.
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
  constructor(
    private readonly prReviewQueue: GitOpsPrReviewQueue,
    @Inject(VCS_PROVIDER_TOKEN)
    private readonly vcsProvider: VcsProvider,
  ) {}

  /**
   * GitHub Pull Request 매니페스트 변경사항에 대해 비동기 PR 검증 작업을 큐에 등록하고 202 Accepted를 반환합니다.
   *
   * @param dto PR 리뷰 검증 요청 데이터 (repository, pullNumber, commitSha, manifestYaml 등)
   * @returns 비동기 큐 작업 식별자 및 queued 상태
   */
  @Post("pr-review")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      "GitHub PR Server-Side Dry-Run 정책 검증 비동기 큐 등록 (HTTP 202)",
    description:
      "PR에서 변경된 쿠버네티스 매니페스트를 BullMQ 분산 작업 큐에 등록하여 AWS Bedrock 및 GitHub API 쿼터를 보호하며 비동기 처리합니다. 수신 즉시 GitHub Check Run을 queued 상태로 발행하고 HTTP 202 Accepted 응답을 반환합니다.",
  })
  @ApiResponse({
    status: 202,
    description: "PR 정책 검증 작업 큐 등록 완료 (비동기 배압 제어 처리)",
    type: GitOpsPrReviewAsyncResponseDto,
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
  ): Promise<GitOpsPrReviewAsyncResponseDto> {
    // 1. GitHub Check Run 상태를 'queued'로 선점 발행 (가능한 경우)
    let checkRunId: number | string | undefined;
    if (this.vcsProvider.createCheckRun) {
      try {
        checkRunId = await this.vcsProvider.createCheckRun({
          repository: dto.repository,
          commitSha: dto.commitSha,
          name: "kyverno/pr-review-gate",
          status: "queued",
          title: "Kyverno Policy Validation Queued",
          summary:
            "Job queued in BullMQ distributed rate limiter for Bedrock quota protection.",
        });
      } catch {
        // Check Run 생성 실패 시 Commit Status fallback으로 진행되거나 무시
      }
    }

    // 2. BullMQ 큐에 작업 Enqueue
    const enqueueResult = await this.prReviewQueue.addReviewJob(
      dto,
      checkRunId,
    );

    return {
      jobId: enqueueResult.id,
      status: "queued",
      checkRunId: enqueueResult.checkRunId,
    };
  }
}
