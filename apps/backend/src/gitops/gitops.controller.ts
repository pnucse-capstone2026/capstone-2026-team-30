import {
  Body,
  Controller,
  HttpStatus,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Response } from "express";
import { CiOrJwtAuthGuard } from "./guards/ci-or-jwt-auth.guard";
import { GitOpsService } from "./gitops.service";
import {
  GitOpsPrReviewAsyncResponseDto,
  GitOpsPrReviewDto,
  GitOpsPrReviewResultDto,
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
 * 하위 호환성을 위해 ?sync=true 또는 dto.async=false 지정 시 즉각적인 동기 검증을 지원합니다.
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
    private readonly gitOpsService: GitOpsService,
    private readonly prReviewQueue: GitOpsPrReviewQueue,
    @Inject(VCS_PROVIDER_TOKEN)
    private readonly vcsProvider: VcsProvider,
  ) {}

  /**
   * GitHub Pull Request 매니페스트 변경사항에 대해 정책 검증을 수행하거나 비동기 작업 큐에 등록합니다.
   *
   * @param dto PR 리뷰 검증 요청 데이터 (repository, pullNumber, commitSha, manifestYaml 등)
   * @param sync 동기식 즉각 검증 실행 여부 플래그 (?sync=true)
   * @param res Express Response 객체 (동적 HTTP 상태 코드 전환용)
   * @returns 동기 검증 결과 DTO (200/201) 또는 비동기 큐 등록 DTO (202)
   */
  @Post("pr-review")
  @ApiOperation({
    summary:
      "GitHub PR Server-Side Dry-Run 정책 검증 (비동기 202 또는 동기 201/200)",
    description:
      "PR에서 변경된 쿠버네티스 매니페스트를 타겟 클러스터의 실제 Kyverno 정책과 대조합니다. 기본적으로 BullMQ 작업 큐에 등록(HTTP 202)되어 비동기로 처리되나, ?sync=true 또는 dto.async=false 지정 시 즉각 동기식으로 검증 결과를 반환(HTTP 201)합니다.",
  })
  @ApiQuery({
    name: "sync",
    required: false,
    type: Boolean,
    description:
      "동기식 즉각 검증 실행 여부 (?sync=true 시 HTTP 201 반환 및 검증 결과 즉시 반환)",
  })
  @ApiResponse({
    status: 200,
    description:
      "동기식 PR 정책 검증 완료 결과 (?sync=true 또는 async=false 시)",
    type: GitOpsPrReviewResultDto,
  })
  @ApiResponse({
    status: 201,
    description:
      "동기식 PR 정책 검증 완료 결과 (?sync=true 또는 async=false 시)",
    type: GitOpsPrReviewResultDto,
  })
  @ApiResponse({
    status: 202,
    description:
      "PR 정책 검증 작업 큐 등록 완료 (비동기 배압 제어 처리, 기본값)",
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
    @Query("sync") sync?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<GitOpsPrReviewResultDto | GitOpsPrReviewAsyncResponseDto> {
    // 1. 동기식 즉각 검증 분기 (?sync=true 이거나 dto.async === false)
    const isSync = sync === "true" || dto.async === false;
    if (isSync) {
      res?.status(HttpStatus.CREATED);
      return await this.gitOpsService.reviewPullRequest(dto);
    }

    // 2. 비동기 큐 등록 분기 (기본값: HTTP 202 Accepted)
    res?.status(HttpStatus.ACCEPTED);

    // 2-1. GitHub Check Run 상태를 'queued'로 선점 발행 (가능한 경우)
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

    // 2-2. BullMQ 큐에 작업 Enqueue
    const enqueueResult = await this.prReviewQueue.addReviewJob(
      dto,
      checkRunId,
    );

    // Redis 장애 시 인라인 동기 검증 Failover 처리
    if (enqueueResult.status === "fallback_sync") {
      res?.status(HttpStatus.CREATED);
      return await this.gitOpsService.reviewPullRequest(dto);
    }

    return {
      jobId: enqueueResult.id,
      status: "queued",
      checkRunId: enqueueResult.checkRunId,
    };
  }
}
