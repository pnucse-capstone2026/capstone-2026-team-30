import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Octokit } from "@octokit/rest";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { SimulationService } from "../simulation/simulation.service";
import { AiAgentService } from "../ai-agent/ai-agent.service";
import { BusinessException } from "../common/errors/business.exception";
import { GITOPS_ERROR } from "./gitops.errors";
import {
  GitOpsPrReviewDto,
  GitOpsPrReviewResultDto,
} from "./dto/gitops-pr-review.dto";
import {
  KyvernoViolationDetail,
  ManifestDryRunValidationResult,
} from "../simulation/dto/dry-run-validation.dto";

/**
 * GitOps PR 거버넌스 게이트 및 PR Bot 검증 서비스
 *
 * 개발자가 생성한 GitHub PR의 매니페스트 변경사항에 대해
 * 클러스터의 실제 Kyverno 정책과 Server-Side Dry-Run으로 대조하고,
 * 위반 발생 시 AI 자가 재검증 루프 및 PR 인라인 코멘트/Commit Status를 기록합니다.
 */
@Injectable()
export class GitOpsService {
  private readonly logger = new Logger(GitOpsService.name);
  private readonly githubToken?: string;
  private readonly platformBaseUrl: string;

  constructor(
    private readonly simulationService: SimulationService,
    private readonly aiAgentService: AiAgentService,
    private readonly clusterProvider: ClusterProvider,
    private readonly configService: ConfigService,
  ) {
    this.githubToken =
      this.configService.get<string>("GITOPS_GITHUB_TOKEN") ||
      this.configService.get<string>("GITHUB_TOKEN");
    this.platformBaseUrl = this.configService.get<string>(
      "PLATFORM_BASE_URL",
      "http://localhost:3000",
    );
  }

  /**
   * GitHub PR 매니페스트에 대해 Server-Side Dry-Run 정책 검증을 수행하고
   * PR 코멘트 및 Commit Status를 자동 전송합니다.
   *
   * @param dto PR 리뷰 검증 요청 데이터
   * @returns 종합 검증 결과, 코멘트 URL, 상태 및 딥링크 정보
   */
  async reviewPullRequest(
    dto: GitOpsPrReviewDto,
  ): Promise<GitOpsPrReviewResultDto> {
    const clusterId = dto.clusterId || "default";

    // 1. 클러스터 접근 권한/존재 여부 확인
    try {
      this.clusterProvider.get(clusterId);
    } catch {
      throw new BusinessException(GITOPS_ERROR.CLUSTER_NOT_FOUND);
    }

    this.logger.log(
      `Starting Server-Side Dry-Run review for PR #${dto.pullNumber} (${dto.repository}) on cluster '${clusterId}', ns '${dto.targetNamespace}'`,
    );

    // 2. Server-Side Dry-Run 실행 (다중 문서 지원)
    let dryRunResult: ManifestDryRunValidationResult;
    try {
      dryRunResult = await this.simulationService.validateManifestDryRun(
        dto.manifestYaml,
        dto.targetNamespace,
        clusterId,
      );
    } catch (err) {
      if (err instanceof BusinessException) {
        throw err;
      }
      this.logger.error(
        `Failed to run dry-run validation for PR #${dto.pullNumber}: ${
          (err as Error).message
        }`,
      );
      throw new BusinessException(GITOPS_ERROR.PR_REVIEW_FAILED);
    }

    const isBlocked = dryRunResult.blockedCount > 0;
    const isError = dryRunResult.errorCount > 0;
    const status: "PASSED" | "BLOCKED" | "ERROR" = isBlocked
      ? "BLOCKED"
      : isError
        ? "ERROR"
        : "PASSED";

    let suggestedDiff: string | undefined;
    let exceptionDeepLink: string | undefined;

    // 3. 위반 발생 시: 예외 딥링크 생성 및 AI 자가 재검증 루프 (Self-Correction Loop)
    if (isBlocked && dryRunResult.allViolations.length > 0) {
      const primaryViolation = dryRunResult.allViolations[0];

      // 프론트엔드 정책 예외 신청 딥링크 생성
      exceptionDeepLink = this.buildExceptionDeepLink({
        repository: dto.repository,
        pullNumber: dto.pullNumber,
        clusterId,
        namespace: dto.targetNamespace,
        policyName: primaryViolation.policyName,
        ruleName: primaryViolation.ruleName,
        kind: dryRunResult.results.find((r) => !r.allowed)?.kind,
        resource: dryRunResult.results.find((r) => !r.allowed)?.name,
      });

      // AI 교정 및 자가 재검증 수행
      suggestedDiff = await this.executeSelfCorrectionLoop(
        dto,
        clusterId,
        dryRunResult.allViolations,
      );
    }

    // 4. GitHub PR Bot 연동: 코멘트 작성 및 Commit Status 등록
    let commentUrl: string | undefined;
    let commitStatus: string | undefined;

    if (this.githubToken) {
      const gitHubResult = await this.publishGitHubFeedback({
        dto,
        dryRunResult,
        status,
        suggestedDiff,
        exceptionDeepLink,
      });
      commentUrl = gitHubResult.commentUrl;
      commitStatus = gitHubResult.commitStatus;
    } else {
      this.logger.warn(
        "GitHub token not configured (GITOPS_GITHUB_TOKEN or GITHUB_TOKEN). Skipping GitHub PR comment and status dispatch.",
      );
      commitStatus = "skipped";
    }

    return {
      valid: dryRunResult.valid,
      blocked: isBlocked,
      totalResources: dryRunResult.totalResources,
      blockedCount: dryRunResult.blockedCount,
      status,
      commentUrl,
      commitStatus,
      suggestedDiff,
      exceptionDeepLink,
      violations: dryRunResult.allViolations,
    };
  }

  /**
   * AI 자동 교정 패치 자체 재검증 루프 (Self-Correction Loop)
   *
   * @param dto PR 요청 DTO
   * @param clusterId 클러스터 식별자
   * @param violations 발생한 정책 위반 목록
   * @returns 재검증을 통과한 YAML 패치 diff 또는 자연어 가이드
   */
  private async executeSelfCorrectionLoop(
    dto: GitOpsPrReviewDto,
    clusterId: string,
    violations: KyvernoViolationDetail[],
  ): Promise<string | undefined> {
    try {
      const primaryViolation = violations[0];
      const explanation = await this.aiAgentService.explainKyvernoError({
        errorMessage: primaryViolation.reason,
        policyYaml: `policy: ${primaryViolation.policyName}`,
        resourceManifest: dto.manifestYaml,
        clusterContext: `cluster: ${clusterId}, namespace: ${dto.targetNamespace}`,
      });

      if (!explanation.suggestedFixYaml) {
        return explanation.summary;
      }

      // 1차 재검증: AI가 제안한 수정 YAML에 대해 Server-Side Dry-Run 재실행
      const reValidation = await this.simulationService.validateManifestDryRun(
        explanation.suggestedFixYaml,
        dto.targetNamespace,
        clusterId,
      );

      if (reValidation.valid) {
        this.logger.log(
          `[Self-Correction] AI proposed fix passed dry-run validation successfully for PR #${dto.pullNumber}`,
        );
        return explanation.suggestedFixYaml;
      }

      // =========================================================================
      // TODO: [Task 1.2 Self-Correction Loop 아웃라인]
      // 1. 재검증 실패 시 (reValidation.valid === false):
      //    - reValidation.allViolations의 상세 실패 사유를 수집
      //    - AI 프롬프트에 "이전 제안이 다음 Kyverno 규칙에 의해 여전히 거부되었습니다" 피드백 주입
      //    - 최대 1회 재시도 (Retry with Feedback) 수행
      // 2. 2회 시도 후에도 통과하지 못할 경우:
      //    - 잘못된 코드 제안을 원천 차단하기 위해 diff 출력을 생략
      //    - 사람이 검토하여 조치할 수 있도록 explanation.summary 및 explanation.resolutionSteps만 반환
      // =========================================================================

      this.logger.warn(
        `[Self-Correction] AI proposed fix failed dry-run re-validation. Falling back to guidance summary. (TODO: implement retry with feedback)`,
      );

      return `<!-- AI Auto-fix could not pass deterministic policy dry-run verification -->\n# 권장 조치 가이드\n${explanation.summary}\n\n## 조치 단계:\n${(explanation.resolutionSteps || []).map((step, idx) => `${idx + 1}. ${step}`).join("\n")}`;
    } catch (err) {
      this.logger.warn(
        `Failed to generate AI fix for PR #${dto.pullNumber}: ${
          (err as Error).message
        }`,
      );
      return undefined;
    }
  }

  /**
   * GitHub Octokit을 활용하여 PR 인라인 코멘트 및 Commit Status를 게시합니다.
   */
  private async publishGitHubFeedback(params: {
    dto: GitOpsPrReviewDto;
    dryRunResult: ManifestDryRunValidationResult;
    status: "PASSED" | "BLOCKED" | "ERROR";
    suggestedDiff?: string;
    exceptionDeepLink?: string;
  }): Promise<{ commentUrl?: string; commitStatus: string }> {
    const { dto, dryRunResult, status, suggestedDiff, exceptionDeepLink } =
      params;
    const [owner, repo] = dto.repository.split("/");

    if (!owner || !repo) {
      this.logger.warn(
        `Invalid repository format: '${dto.repository}'. Expected 'owner/repo'.`,
      );
      return { commitStatus: "skipped" };
    }

    const octokit = new Octokit({ auth: this.githubToken });

    // 1. PR 코멘트 마크다운 본문 빌드
    const commentBody = this.buildPrCommentMarkdown({
      dto,
      dryRunResult,
      status,
      suggestedDiff,
      exceptionDeepLink,
    });

    let commentUrl: string | undefined;
    try {
      const commentRes = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: dto.pullNumber,
        body: commentBody,
      });
      commentUrl = commentRes.data.html_url;
      this.logger.log(
        `Posted governance gate comment to PR #${dto.pullNumber}: ${commentUrl}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to create GitHub PR comment for #${dto.pullNumber}: ${
          (err as Error).message
        }`,
      );
    }

    // 2. Commit Status 전송
    // 정책: Enforce 차단 시 'failure', 통과 또는 Audit 경고 시 'success' (with warnings)
    let commitStatus: "success" | "failure" = "success";
    let statusDescription = "Kyverno governance validation passed";

    if (dryRunResult.blockedCount > 0) {
      commitStatus = "failure";
      statusDescription = `Kyverno policy violation: ${dryRunResult.blockedCount} resource(s) blocked`;
    } else if (dryRunResult.errorCount > 0) {
      commitStatus = "failure";
      statusDescription = `Manifest validation failed: ${dryRunResult.errorCount} error(s)`;
    } else if (dryRunResult.allViolations.length > 0) {
      commitStatus = "success";
      statusDescription = "Passed with Kyverno audit warnings";
    }

    try {
      await octokit.rest.repos.createCommitStatus({
        owner,
        repo,
        sha: dto.commitSha,
        state: commitStatus,
        context: "kyverno/governance-gate",
        description: statusDescription,
        target_url: exceptionDeepLink || this.platformBaseUrl,
      });
      this.logger.log(
        `Dispatched commit status '${commitStatus}' to commit ${dto.commitSha.slice(0, 7)}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to create GitHub commit status for ${dto.commitSha}: ${
          (err as Error).message
        }`,
      );
    }

    return { commentUrl, commitStatus };
  }

  /**
   * 플랫폼 정책 예외 신청 페이지 딥링크 URL을 생성합니다.
   */
  private buildExceptionDeepLink(params: {
    repository: string;
    pullNumber: number;
    clusterId: string;
    namespace: string;
    policyName?: string;
    ruleName?: string;
    kind?: string;
    resource?: string;
  }): string {
    const url = new URL("/exceptions/new", this.platformBaseUrl);
    url.searchParams.set("repo", params.repository);
    url.searchParams.set("pr", String(params.pullNumber));
    url.searchParams.set("cluster", params.clusterId);
    url.searchParams.set("namespace", params.namespace);
    if (params.policyName) url.searchParams.set("policy", params.policyName);
    if (params.ruleName) url.searchParams.set("rule", params.ruleName);
    if (params.kind) url.searchParams.set("kind", params.kind);
    if (params.resource) url.searchParams.set("resource", params.resource);

    return url.toString();
  }

  /**
   * PR Bot 마크다운 코멘트를 생성합니다.
   */
  private buildPrCommentMarkdown(params: {
    dto: GitOpsPrReviewDto;
    dryRunResult: ManifestDryRunValidationResult;
    status: "PASSED" | "BLOCKED" | "ERROR";
    suggestedDiff?: string;
    exceptionDeepLink?: string;
  }): string {
    const { dto, dryRunResult, status, suggestedDiff, exceptionDeepLink } =
      params;

    if (status === "PASSED") {
      return `## 🛡️ Kyverno Governance Gate: ✅ PASSED

모든 쿠버네티스 리소스 매니페스트가 플랫폼 보안 및 거버넌스 정책을 정상적으로 통과했습니다.

* **검증 리소스 수**: ${dryRunResult.totalResources}개
* **타겟 네임스페이스**: \`${dto.targetNamespace}\`
* **타겟 클러스터**: \`${dto.clusterId || "default"}\`
* **검증 방식**: Server-Side Dry-Run (\`dryRun: ['All']\`)

---
*Generated by Kyverno Governance Platform Shift-Left Gate.*`;
    }

    // BLOCKED 또는 ERROR 상태
    let markdown = `## 🛡️ Kyverno Governance Gate: ❌ BLOCKED

제출된 쿠버네티스 매니페스트 중 조직의 거버넌스 정책에 위배되는 항목이 감지되어 배포가 차단되었습니다.

* **타겟 네임스페이스**: \`${dto.targetNamespace}\`
* **타겟 클러스터**: \`${dto.clusterId || "default"}\`
* **차단된 리소스**: **${dryRunResult.blockedCount}** / ${dryRunResult.totalResources}

### 📋 정책 위반 상세 내역 (Violations)
| 리소스 | 위반 정책 (Policy) | 위반 규칙 (Rule) | 상세 사유 |
| :--- | :--- | :--- | :--- |
`;

    for (const res of dryRunResult.results) {
      if (res.status === "BLOCKED") {
        const resourceId = `\`${res.kind}/${res.name}\``;
        if (res.violations.length > 0) {
          for (const v of res.violations) {
            markdown += `| ${resourceId} | \`${v.policyName}\` | \`${v.ruleName || "-"}\` | ${v.reason} |\n`;
          }
        } else {
          markdown += `| ${resourceId} | - | - | ${res.blockedReason || res.message} |\n`;
        }
      } else if (res.status === "ERROR") {
        markdown += `| \`${res.kind}/${res.name}\` | *API Error* | - | ${res.message} |\n`;
      }
    }

    if (suggestedDiff) {
      markdown += `\n### 🤖 AI 자동 교정 제안 (Self-Corrected Recommendation)
\`\`\`yaml
${suggestedDiff}
\`\`\`
`;
    }

    if (exceptionDeepLink) {
      markdown += `\n### 📝 정책 예외(Policy Exception) 신청
본 워크로드의 특수 요구사항으로 인해 정책 준수가 즉시 불가능한 경우, 아래 딥링크를 통해 사전 입력된 정보로 정책 예외를 신청할 수 있습니다:
👉 [**플랫폼 정책 예외 신청하기 (Auto-filled Link)**](${exceptionDeepLink})
`;
    }

    markdown += `\n---\n*Verified with deterministic Server-Side Dry-Run by Kyverno Governance Platform.*`;

    return markdown;
  }
}
