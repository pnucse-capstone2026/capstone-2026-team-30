import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { SimulationService } from "../simulation/simulation.service";
import { AiAgentService } from "../ai-agent/ai-agent.service";
import { KyvernoRuleTemplateEngine } from "../ai-agent/rule-template.engine";
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
import {
  VCS_PROVIDER_TOKEN,
  VcsProvider,
} from "./providers/vcs-provider.interface";

/**
 * GitOps PR 거버넌스 게이트 및 PR Bot 검증 서비스
 *
 * 개발자가 생성한 PR의 매니페스트 변경사항에 대해
 * 2단계(Tier 1 로컬 인메모리 Fast-Fail + Tier 2 K8s Server-Side Dry-Run) 파이프라인으로 검증하고,
 * 위반 발생 시 AI 자가 재검증 루프 및 PR 인라인 코멘트/Commit Status를 기록합니다.
 */
@Injectable()
export class GitOpsService {
  private readonly logger = new Logger(GitOpsService.name);
  private readonly platformBaseUrl: string;

  constructor(
    private readonly simulationService: SimulationService,
    private readonly aiAgentService: AiAgentService,
    private readonly clusterProvider: ClusterProvider,
    private readonly configService: ConfigService,
    @Inject(VCS_PROVIDER_TOKEN)
    private readonly vcsProvider: VcsProvider,
    @Optional()
    private readonly ruleTemplateEngine?: KyvernoRuleTemplateEngine,
  ) {
    this.platformBaseUrl = this.configService.get<string>(
      "PLATFORM_BASE_URL",
      "http://localhost:3000",
    );
  }

  /**
   * GitHub PR 매니페스트에 대해 2-Tier 정책 검증을 수행하고
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
      `Starting 2-Tier PR review for PR #${dto.pullNumber} (${dto.repository}) on cluster '${clusterId}', ns '${dto.targetNamespace}'`,
    );

    // 2. 2-Tier 검증 파이프라인
    let dryRunResult: ManifestDryRunValidationResult;
    const engine = this.ruleTemplateEngine ?? new KyvernoRuleTemplateEngine();
    const tier1Result = engine.preValidateManifest(dto.manifestYaml);

    if (!tier1Result.valid && tier1Result.violations.length > 0) {
      // 2.1 Tier 1 Fast-Fail: K8s API Server 및 Webhook 호출 완전 생략(Bypass)
      this.logger.warn(
        `[Tier 1 Fast-Fail] K8s Webhook Call Bypassed: ${tier1Result.violations.length} violations detected in ${tier1Result.latencyMs}ms for PR #${dto.pullNumber}`,
      );

      dryRunResult = {
        valid: false,
        allowed: false,
        totalResources: tier1Result.totalResources,
        blockedCount: tier1Result.blockedCount,
        passedCount: tier1Result.passedCount,
        errorCount: 0,
        results: tier1Result.results.map((r) => ({
          apiVersion: r.apiVersion || "apps/v1",
          kind: r.kind || "Deployment",
          name: r.name || "workload",
          namespace: r.namespace || dto.targetNamespace,
          allowed: r.allowed,
          status: r.allowed ? "PASSED" : "BLOCKED",
          blockedReason: r.violations[0]?.reason,
          violations: r.violations,
        })),
        allViolations: tier1Result.violations,
      };
    } else {
      // 2.2 Tier 1 Safe Pass: 최종 권위(Authoritative) 관문으로서 실제 K8s Server-Side Dry-Run 수행
      this.logger.log(
        `[Tier 1 Passed] Proceeding to Tier 2 Server-Side Dry-Run validation for PR #${dto.pullNumber} (${tier1Result.latencyMs}ms)`,
      );

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
    let selfCorrectionResult:
      | {
          corrected: boolean;
          attempts: number;
          suggestedPatch?: string;
          guidance?: string;
        }
      | undefined;

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
      const outcome = await this.executeSelfCorrectionLoop(
        dto,
        clusterId,
        dryRunResult.allViolations,
      );
      suggestedDiff = outcome.suggestedDiff;
      selfCorrectionResult = outcome.selfCorrectionResult;
    }

    // PR 코멘트 마크다운 본문 빌드
    const commentMarkdown = this.buildPrCommentMarkdown({
      dto,
      dryRunResult,
      status,
      suggestedDiff,
      exceptionDeepLink,
    });

    // 4. VCS PR Bot 연동: 코멘트 작성 및 Commit Status 등록 (VcsProvider에 위임)
    const vcsResult = await this.publishVcsFeedback({
      dto,
      dryRunResult,
      status,
      commentBody: commentMarkdown,
      exceptionDeepLink,
    });
    const commentUrl = vcsResult.commentUrl;
    const commitStatus = vcsResult.commitStatus;

    return {
      valid: dryRunResult.valid,
      dryRunPassed: dryRunResult.valid,
      blocked: isBlocked,
      totalResources: dryRunResult.totalResources,
      blockedCount: dryRunResult.blockedCount,
      status,
      commentUrl,
      commentMarkdown,
      commitStatus,
      suggestedDiff,
      selfCorrectionResult,
      exceptionDeepLink,
      violations: dryRunResult.allViolations,
    };
  }

  /**
   * AI 자동 교정 패치 자체 재검증 루프 (Self-Correction Loop)
   *
   * 1차 AI 제안 YAML을 Server-Side Dry-Run으로 재검증하고,
   * 실패 시 1차 실패 피드백을 주입하여 최대 1회 재시도(Retry with Feedback)합니다.
   * 2차 시도까지 모두 실패할 경우 잘못된 diff 대신 안내 가이드 마크다운으로 안전하게 폴백합니다.
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
  ): Promise<{
    suggestedDiff?: string;
    selfCorrectionResult: {
      corrected: boolean;
      attempts: number;
      suggestedPatch?: string;
      guidance?: string;
    };
  }> {
    try {
      const primaryViolation = violations[0];

      // 1. 1차 AI 수정안 생성 요청
      const firstExplanation = await this.aiAgentService.explainKyvernoError({
        errorMessage: primaryViolation.reason,
        policyYaml: `policy: ${primaryViolation.policyName}`,
        resourceManifest: dto.manifestYaml,
        clusterContext: `cluster: ${clusterId}, namespace: ${dto.targetNamespace}`,
      });

      if (!firstExplanation.suggestedFixYaml) {
        return {
          suggestedDiff: `<!-- AI Auto-fix could not pass deterministic policy dry-run verification -->\n# 권장 조치 가이드\n${firstExplanation.summary}\n\n## 조치 단계:\n${(firstExplanation.resolutionSteps || []).map((step, idx) => `${idx + 1}. ${step}`).join("\n")}`,
          selfCorrectionResult: {
            corrected: false,
            attempts: 1,
            guidance: firstExplanation.summary,
          },
        };
      }

      // 2. 1차 Server-Side Dry-Run 재검증 실행
      const firstValidation =
        await this.simulationService.validateManifestDryRun(
          firstExplanation.suggestedFixYaml,
          dto.targetNamespace,
          clusterId,
        );

      if (firstValidation.valid) {
        this.logger.log(
          `[Self-Correction] 1st AI proposed fix passed dry-run validation successfully for PR #${dto.pullNumber}`,
        );
        return {
          suggestedDiff: firstExplanation.suggestedFixYaml,
          selfCorrectionResult: {
            corrected: true,
            attempts: 1,
            suggestedPatch: firstExplanation.suggestedFixYaml,
          },
        };
      }

      this.logger.warn(
        `[Self-Correction] 1st AI fix failed dry-run re-validation for PR #${dto.pullNumber}. Retrying with feedback...`,
      );

      // 3. 2차 시도 (Retry with Feedback): 위반 내역 및 실패 사유 수집
      const unresolvedViolations =
        firstValidation.allViolations &&
        firstValidation.allViolations.length > 0
          ? firstValidation.allViolations
              .map(
                (v) =>
                  `- [Policy: ${v.policyName}] [Rule: ${v.ruleName || "-"}] ${v.reason}`,
              )
              .join("\n")
          : "Dry-Run rejected the manifest with unhandled errors.";

      const validationFeedback = `이전 수정본이 여전히 다음 정책 위반으로 거부되었습니다. 해당 규칙을 엄격히 준수하도록 YAML을 다시 수정하세요:\n${unresolvedViolations}`;

      // 4. 피드백 컨텍스트를 주입하여 2차 AI 수정안 생성 요청
      const secondExplanation = await this.aiAgentService.explainKyvernoError({
        errorMessage: `${primaryViolation.reason}\n\n[Re-validation Failures]:\n${unresolvedViolations}`,
        policyYaml: `policy: ${primaryViolation.policyName}`,
        resourceManifest: dto.manifestYaml,
        clusterContext: `cluster: ${clusterId}, namespace: ${dto.targetNamespace}`,
        previousAttemptYaml: firstExplanation.suggestedFixYaml,
        validationFeedback,
      });

      // 2차 생성된 YAML이 존재하는 경우 2차 Server-Side Dry-Run 재검증 수행
      if (secondExplanation.suggestedFixYaml) {
        const secondValidation =
          await this.simulationService.validateManifestDryRun(
            secondExplanation.suggestedFixYaml,
            dto.targetNamespace,
            clusterId,
          );

        if (secondValidation.valid) {
          this.logger.log(
            `[Self-Correction] 2nd AI proposed fix passed dry-run validation successfully for PR #${dto.pullNumber}`,
          );
          return {
            suggestedDiff: secondExplanation.suggestedFixYaml,
            selfCorrectionResult: {
              corrected: true,
              attempts: 2,
              suggestedPatch: secondExplanation.suggestedFixYaml,
            },
          };
        }
      }

      // 5. 2차 실패 시 안전 폴백 (Safe Fallback): 잘못된 코드 diff 노출을 원천 차단하고 가이드 반환
      this.logger.warn(
        `[Self-Correction] All self-correction attempts failed dry-run re-validation for PR #${dto.pullNumber}. Falling back to safe guidance.`,
      );

      const finalExplanation = secondExplanation || firstExplanation;
      return {
        suggestedDiff: `<!-- AI Auto-fix could not pass deterministic policy dry-run verification -->\n# 권장 조치 가이드\n${finalExplanation.summary}\n\n## 조치 단계:\n${(finalExplanation.resolutionSteps || []).map((step, idx) => `${idx + 1}. ${step}`).join("\n")}`,
        selfCorrectionResult: {
          corrected: false,
          attempts: 2,
          guidance: finalExplanation.summary,
        },
      };
    } catch (err) {
      this.logger.warn(
        `Failed to generate AI fix for PR #${dto.pullNumber}: ${
          (err as Error).message
        }`,
      );
      return {
        suggestedDiff: undefined,
        selfCorrectionResult: {
          corrected: false,
          attempts: 1,
          guidance: (err as Error).message,
        },
      };
    }
  }

  /**
   * VcsProvider를 활용하여 PR 인라인 코멘트 및 Commit Status를 게시합니다.
   */
  private async publishVcsFeedback(params: {
    dto: GitOpsPrReviewDto;
    dryRunResult: ManifestDryRunValidationResult;
    status: "PASSED" | "BLOCKED" | "ERROR";
    commentBody: string;
    exceptionDeepLink?: string;
  }): Promise<{ commentUrl?: string; commitStatus: string }> {
    const { dto, dryRunResult, commentBody, exceptionDeepLink } = params;
    const [owner, repo] = dto.repository.split("/");

    if (!owner || !repo) {
      this.logger.warn(
        `Invalid repository format: '${dto.repository}'. Expected 'owner/repo'.`,
      );
      return { commitStatus: "skipped" };
    }

    // 1. PR 마크다운 코멘트 전송 (VcsProvider에 위임)
    const commentUrl = await this.vcsProvider.postReviewComment({
      repository: dto.repository,
      pullNumber: dto.pullNumber,
      commentMarkdown: commentBody,
    });

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

    await this.vcsProvider.setCommitStatus({
      repository: dto.repository,
      commitSha: dto.commitSha,
      state: commitStatus,
      context: "kyverno/governance-gate",
      description: statusDescription,
      targetUrl: exceptionDeepLink || this.platformBaseUrl,
    });

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
    url.searchParams.set("clusterId", params.clusterId);
    url.searchParams.set("namespace", params.namespace);
    if (params.policyName) {
      url.searchParams.set("policy", params.policyName);
      url.searchParams.set("policyName", params.policyName);
    }
    if (params.ruleName) url.searchParams.set("rule", params.ruleName);
    if (params.kind) url.searchParams.set("kind", params.kind);
    if (params.resource) {
      url.searchParams.set("resource", params.resource);
      url.searchParams.set("resourceName", params.resource);
    }

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
      if (
        suggestedDiff.startsWith(
          "<!-- AI Auto-fix could not pass deterministic policy dry-run verification -->",
        )
      ) {
        markdown += `\n### 🤖 AI 권장 조치 가이드 (Manual Review Required) \`[AI Self-Correction Incomplete / Safe Guidance]\`
${suggestedDiff}
`;
      } else {
        markdown += `\n### 🤖 AI 자동 교정 제안 \`[AI Self-Correction Passed]\`
> **Server-Side Dry-Run 검증 통과**: 아래 제안된 매니페스트는 클러스터의 Kyverno 정책을 완벽히 준수하도록 자체 재검증되었습니다.

\`\`\`suggestion
${suggestedDiff}
\`\`\`
`;
      }
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
