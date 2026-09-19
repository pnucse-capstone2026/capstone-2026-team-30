import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import {
  LLM_PROVIDER_TOKEN,
  LlmProvider,
} from "./providers/llm-provider.interface";
import {
  AnalysisMode,
  AnalysisTaskScope,
  ExplainKyvernoErrorDto,
  KyvernoErrorExplanationResultDto,
} from "./dto/explain-error.dto";
import { KyvernoRuleTemplateEngine } from "./rule-template.engine";
import { WorkloadEvaluatorService } from "./services/workload-evaluator.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { BusinessException } from "../common/errors/business.exception";
import { POLICY_ERROR } from "../policies/policy.errors";
import { AuthenticatedUser } from "../auth/auth.types";

/**
 * K8s API 조회가 불가하거나 비어 있는 경우 적용할 표준 사내 거버넌스 가이드라인
 */
export const DEFAULT_GOVERNANCE_POLICIES: readonly string[] = Object.freeze([
  "- Cluster: Enterprise Kubernetes Environment (Kyverno v1.12+ Active)",
  "- Active Enterprise Governance Policies in Effect:",
  "  * disallow-latest-tag [Enforce]: Disallow ':latest' tag, require explicit immutable versions",
  "  * require-labels [Enforce]: Require 'app.kubernetes.io/name' and 'team' labels",
  "  * restrict-image-registries [Enforce]: Only allow approved registries (public.ecr.aws, registry.k8s.io, private ECR)",
  "  * disallow-privileged-containers [Enforce]: Disallow securityContext.privileged: true",
  "  * require-resource-limits [Enforce]: Require CPU & Memory limits/requests",
]);

/**
 * 플랫폼 비전문 사용자를 위한 Kyverno 오류 해설 및 수정 가이드 생성 AI 에이전트 서비스
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly timeoutMs: number;

  /**
   * 클러스터별 활성 Kyverno 정책 인메모리 캐시 (기본 TTL: 2분)
   */
  private readonly policyCache = new Map<
    string,
    { policies: Array<Record<string, unknown>>; expiresAt: number }
  >();
  private readonly policyCacheTtlMs = 120_000;

  constructor(
    @Inject(LLM_PROVIDER_TOKEN)
    private readonly llmProvider: LlmProvider,
    private readonly ruleTemplateEngine: KyvernoRuleTemplateEngine,
    private readonly workloadEvaluator: WorkloadEvaluatorService,
    config: ConfigService,
    @Optional()
    private readonly clusterProvider?: ClusterProvider,
    @Optional()
    private readonly kyvernoAdapter?: KyvernoAdapter,
    @Optional()
    private readonly moduleRef?: ModuleRef,
  ) {
    // LLM API 응답 대기 상한 타임아웃 (기본값: 15000ms)
    const configuredTimeout = Number(
      config.get<string>("AI_ANALYSIS_TIMEOUT_MS", "15000"),
    );
    this.timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 15000;
  }

  /**
   * 순환 모듈 의존성을 회피하기 위해 ModuleRef를 통해 런타임에 ClusterProvider를 안전하게 지연 조회합니다.
   */
  private resolveClusterProvider(): ClusterProvider | undefined {
    if (this.clusterProvider) return this.clusterProvider;
    if (this.moduleRef) {
      try {
        return this.moduleRef.get(ClusterProvider, { strict: false });
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * 순환 모듈 의존성을 회피하기 위해 ModuleRef를 통해 런타임에 KyvernoAdapter를 안전하게 지연 조회합니다.
   */
  private resolveKyvernoAdapter(): KyvernoAdapter | undefined {
    if (this.kyvernoAdapter) return this.kyvernoAdapter;
    if (this.moduleRef) {
      try {
        return this.moduleRef.get(KyvernoAdapter, { strict: false });
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * 클러스터의 활성 Kyverno 정책을 캐시에서 조회하고, 만료되었거나 없을 때만 K8s API 서버에서 로드합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @returns 클러스터 정책 목록
   */
  async getCachedClusterPolicies(
    clusterId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const cached = this.policyCache.get(clusterId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.policies;
    }

    const adapter = this.resolveKyvernoAdapter();
    if (!adapter) {
      return [];
    }

    const policies = (await adapter.listClusterPolicies(clusterId)) || [];
    const typedPolicies = policies as unknown as Array<Record<string, unknown>>;
    this.policyCache.set(clusterId, {
      policies: typedPolicies,
      expiresAt: Date.now() + this.policyCacheTtlMs,
    });
    return typedPolicies;
  }

  /**
   * 정책 캐시를 수동 초기화합니다 (테스트용)
   */
  clearPolicyCache(): void {
    this.policyCache.clear();
  }

  /**
   * 대상 클러스터의 활성 Kyverno 정책 목록과 클러스터 환경 구조를 요약하여 컨텍스트 문자열을 구성합니다.
   * K8s API 조회가 불가하거나 비어 있는 경우 표준 사내 거버넌스 가이드라인으로 안전하게 fallback합니다.
   *
   * @param clusterId 대상 클러스터 ID (선택)
   * @param namespace 대상 네임스페이스 (선택)
   * @returns 클러스터 거버넌스 및 활성 정책 요약 문자열
   */
  async buildClusterGovernanceContext(
    clusterId?: string,
    namespace?: string,
  ): Promise<string> {
    const lines: string[] = [];

    let targetClusterId = clusterId;
    const clusterProvider = this.resolveClusterProvider();
    if (clusterProvider) {
      try {
        const allClusters = clusterProvider.list();
        const cluster = targetClusterId
          ? allClusters.find(
              (c) =>
                c.id === targetClusterId || c.displayName === targetClusterId,
            )
          : allClusters[0];

        if (cluster) {
          targetClusterId = cluster.id;
          lines.push(
            `- Target Cluster: ${cluster.displayName || cluster.id} (ID: ${cluster.id})`,
          );
        }
      } catch (err) {
        this.logger.debug(
          `Failed to inspect cluster metadata: ${(err as Error).message}`,
        );
      }
    }

    if (!targetClusterId) {
      targetClusterId = "default";
    }

    if (namespace) {
      lines.push(`- Target Namespace: ${namespace}`);
    }

    const kyvernoAdapter = this.resolveKyvernoAdapter();
    if (kyvernoAdapter) {
      try {
        const clusterPolicies =
          await this.getCachedClusterPolicies(targetClusterId);
        if (clusterPolicies && clusterPolicies.length > 0) {
          lines.push(
            `- Active Kyverno ClusterPolicies in Cluster (${clusterPolicies.length} policies enforced/audited):`,
          );
          for (const p of clusterPolicies) {
            const metadata = p.metadata as { name?: string } | undefined;
            const name = metadata?.name || "unnamed";
            const spec = p.spec as Record<string, unknown> | undefined;
            const action =
              (spec?.validationFailureAction as string) || "Enforce";
            const rules = (spec?.rules || []) as Array<{
              name?: string;
              validate?: { message?: string };
            }>;
            const ruleSummaries = rules
              .map((r) => r.validate?.message || r.name)
              .filter(Boolean)
              .slice(0, 2)
              .join("; ");
            lines.push(
              `  * ${name} [Mode: ${action}]${ruleSummaries ? `: ${ruleSummaries}` : ""}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to retrieve live cluster policies for context: ${(err as Error).message}`,
        );
      }
    }

    // 클러스터 API 연결이 없거나 정책 조회가 비어있는 경우 표준 사내 거버넌스 가이드라인으로 보완
    if (lines.length === 0) {
      lines.push(...DEFAULT_GOVERNANCE_POLICIES);
    }

    return lines.join("\n");
  }

  /**
   * 사용자의 클러스터 접근 권한(Role 또는 clusterIds 배정)을 검증합니다.
   */
  private validateClusterAccess(
    user: AuthenticatedUser,
    clusterId: string,
  ): void {
    if (user.role !== "ADMIN" && !user.clusterIds.includes(clusterId)) {
      throw new BusinessException(POLICY_ERROR.CLUSTER_ACCESS_DENIED);
    }
  }

  /**
   * Kyverno 정책 위반 오류 메시지 및 K8s 매니페스트 context를 분석하여 쉬운 해설 리포트를 생성합니다.
   * 설정된 LLM 프로바이더 통신에 타임아웃이 발생하거나 실패할 경우 룰 기반 Graceful Fallback 엔진으로 즉각 전환합니다.
   *
   * @param dto Kyverno 오류 메시지, 정책 YAML, 쿠버네티스 매니페스트, 클러스터 상태 정보
   * @param user 요청자 정보 (선택, 클러스터 접근 스코프 검증용)
   * @returns 쉬운 해설, 단계별 조치 방법, 수정 매니페스트 및 보안 거버넌스 배경
   */
  async explainKyvernoError(
    dto: ExplainKyvernoErrorDto,
    user?: AuthenticatedUser,
  ): Promise<KyvernoErrorExplanationResultDto> {
    const startTime = Date.now();

    // 사용자가 특정 클러스터를 지정한 경우 권한 스코프 유효성 검증
    if (user && dto.clusterId) {
      this.validateClusterAccess(user, dto.clusterId);
    }

    // 1. 매니페스트가 제공된 경우 Tier 1 인메모리 Fast-Fail 선검증 수행
    let preValidationViolations: any[] = [];
    if (dto.resourceManifest && dto.resourceManifest.trim()) {
      try {
        const preValidation = this.ruleTemplateEngine.preValidateManifest(
          dto.resourceManifest,
        );
        preValidationViolations = preValidation.violations || [];

        // 에러 메시지가 비어있거나 사전 점검 요청인 경우: 위반이 전혀 없으면 즉시 정상(Compliant) 반환
        if (!dto.errorMessage || !dto.errorMessage.trim()) {
          if (preValidation.valid && preValidationViolations.length === 0) {
            this.logger.log(
              `[AiAgent] Manifest pre-validation passed without violations. Returning COMPLIANT result immediately.`,
            );
            return {
              isCompliant: true,
              status: "COMPLIANT",
              summary:
                "입력하신 Kubernetes 매니페스트에서 Kyverno 거버넌스 정책 위반이나 배포 차단 요인을 발견하지 못했습니다. 현재 클러스터 거버넌스 정책 기준을 완벽히 준수하고 있습니다.",
              resolutionSteps: [
                "필수 레이블(app.kubernetes.io/name, team) 설정이 확인되었습니다.",
                "컨테이너 이미지 태그의 불변성(Immutable tag) 및 허용된 레지스트리 규격을 충족합니다.",
                "CPU/메모리 상한선(limits) 및 요청량(requests)이 정상 정의되었습니다.",
                "보안 컨텍스트(비특권, 권한 상승 제한 등) 규격을 충족하여 즉시 클러스터에 배포(kubectl apply)할 수 있습니다.",
              ],
              suggestedFixYaml: null,
              governanceRationale:
                "보안 취약점 예방, 클러스터 노드 자원 고갈 방지, 비용 추적 태깅 등 프로덕션 거버넌스 모범 표준(Best Practice)을 충족합니다.",
              passedRules: [
                "disallow-latest-tag (이미지 고정 태그 준수)",
                "require-labels (필수 메타데이터 레이블 설정)",
                "require-resource-limits (컴퓨팅 자원 상한선 정의)",
                "disallow-privileged-containers (비특권 컨테이너 격리)",
              ],
              violations: [],
              provider: "FAST_FAIL_PRE_VALIDATION",
              analysisMode: AnalysisMode.SINGLE_AGENT,
              taskScope: AnalysisTaskScope.SINGLE_RESOURCE,
              latencyMs: Date.now() - startTime,
            };
          }

          // 에러 메시지가 없었지만 선검증에서 위반이 발견된 경우, 위반 내용으로 에러 메시지 구성
          dto.errorMessage = `Kyverno admission webhook rejection simulated: ${preValidationViolations
            .map((v) => `[${v.policyName}] rule ${v.ruleName}: ${v.reason}`)
            .join("; ")}`;
        }
      } catch (preValErr) {
        this.logger.warn(
          `Pre-validation execution error: ${(preValErr as Error).message}`,
        );
      }
    }

    const evalResult = this.workloadEvaluator.evaluate(dto);

    const liveContext = await this.buildClusterGovernanceContext(
      dto.clusterId,
      dto.namespace,
    );

    const mergedClusterContext = dto.clusterContext
      ? `${liveContext}\n- Additional Client Context: ${dto.clusterContext}`
      : liveContext;

    this.logger.log(
      `[AiAgent] Diagnosing with live cluster context (${dto.clusterId || "default"}): ${liveContext.split("\n")[0]}`,
    );

    const systemPrompt = `You are a world-class, empathetic Kubernetes Platform Engineering AI Assistant.
Your mission is to evaluate Kubernetes manifests against Kyverno policy governance rules, explain rejections, and guide developers to successful deployments.

Target Audience & Tone:
1. For junior developers or users without deep Kubernetes expertise: Explain root causes and terminology using intuitive, plain Korean analogies. Avoid intimidating jargon and provide gentle, step-by-step guidance.
2. For senior engineers and platform administrators: Provide accurate technical rationale, architectural context, and precise Kubernetes specification details.

CRITICAL INSTRUCTION - HOLISTIC CLUSTER POLICY COMPLIANCE & ACCURATE ASSESSMENT:
1. CHECK FOR COMPLIANCE OR INFRASTRUCTURE ERRORS:
   - If the user submitted manifest does NOT violate any cluster policies, or if the error indicates an infrastructure/environment issue (such as 'namespaces ... not found', 'Unauthorized', 'network timeout', or invalid kubeconfig) rather than a Kyverno admission rejection:
     * Set "isCompliant": true if the manifest has no governance violations, otherwise false.
     * Set "status": "COMPLIANT" if valid, or "ERROR" if it's an infrastructure issue.
     * In "summary": Clearly explain in empathetic Korean that no Kyverno policy violations were found in the manifest (and note the infrastructure cause if applicable). DO NOT invent false policy violations or demand unnecessary changes.
     * Set "suggestedFixYaml": null (or keep original manifest).
2. IF VIOLATIONS EXIST (status: "BLOCKED"):
   The cluster enforces multiple simultaneous Kyverno policies (see [Cluster Environment & Active Governance Policies Context]).
   When generating "suggestedFixYaml", YOU MUST OUTPUT A COMPLETE, READY-TO-DEPLOY YAML MANIFEST that satisfies ALL ACTIVE RULES SIMULTANEOUSLY:
   - Fix the primary policy error described in [Kyverno Error Message].
   - Comply with ALL OTHER ACTIVE POLICIES in the cluster:
     * If 'restrict-image-registries' is active or images need changing: ALWAYS use approved enterprise registries (e.g. 'public.ecr.aws/docker/library/nginx:1.25.4' or 'registry.k8s.io/pause:3.10'). NEVER use bare 'nginx:1.21.1' or unverified Docker Hub root images.
     * If 'require-labels' is active: ALWAYS ensure 'metadata.labels["app.kubernetes.io/name"]' and 'metadata.labels["team"]' (e.g. team: devops) are explicitly present in the YAML.
     * If 'require-resource-limits' is active: ALWAYS ensure container resources (limits: cpu: 100m, memory: 128Mi / requests: cpu: 50m, memory: 64Mi) are defined.
     * For critical security violations involving 'securityContext.privileged: true', hostNetwork, or hostPID, do NOT remove them arbitrarily. Set suggestedFixYaml to null and instruct the developer to submit a PolicyException or use least-privilege alternatives.

Output format MUST be a valid JSON object matching the following structure without codeblock wrapper or markdown syntax:
{
  "isCompliant": true,
  "status": "COMPLIANT",
  "summary": "Easy-to-understand explanation in Korean",
  "resolutionSteps": ["Step 1 explanation in Korean", "Step 2 explanation in Korean", "..."],
  "suggestedFixYaml": "Valid corrected YAML manifest snippet if applicable (or null if compliant/PolicyException required)",
  "governanceRationale": "Why this policy and associated cluster governance rules exist (security, cost, cluster stability) in Korean"
}`;

    let feedbackSection = "";
    if (dto.previousAttemptYaml || dto.validationFeedback) {
      feedbackSection = `
[Previous Attempted Manifest]
${dto.previousAttemptYaml || "N/A"}

[Dry-Run Re-validation Feedback / Unresolved Violations]
${dto.validationFeedback || "N/A"}

[Self-Correction Instruction]
The previous attempted manifest fix was rejected by Server-Side Dry-Run validation.
Strictly resolve all the unresolved Kyverno violations above while adhering to Kubernetes specifications.
`;
    }

    const userPrompt = `
[Kyverno Error Message]
${dto.errorMessage || "(No error message provided - pre-deployment assessment requested)"}

[Applied Kyverno Policy]
${dto.policyYaml || "N/A"}

[User Submitted Resource Manifest]
${dto.resourceManifest || "N/A"}

[Cluster Environment & Active Governance Policies Context]
${mergedClusterContext}
${feedbackSection}
Please evaluate whether this manifest violates cluster policies. If compliant, declare it compliant. If blocked, provide the diagnostic JSON response.
`;

    try {
      // 타임아웃 시 AI 호출을 취소하고 Fallback 엔진으로 자동 전환하는 Promise.race 제어
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Bedrock API request timed out after ${this.timeoutMs}ms`,
              ),
            ),
          this.timeoutMs,
        ),
      );

      const rawResponse = (await Promise.race([
        this.llmProvider.chatCompletion(systemPrompt, userPrompt),
        timeoutPromise,
      ])) as string;

      const latencyMs = Date.now() - startTime;

      // 모델 응답에 markdown ```json 태그가 포함되어 있을 경우를 대비하여 파싱 전 정제합니다.
      const cleaned = rawResponse.replace(/```json\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(cleaned) as KyvernoErrorExplanationResultDto;

      const isCompliant =
        parsed.isCompliant ??
        (parsed.status === "COMPLIANT" ||
          (!dto.errorMessage && preValidationViolations.length === 0));
      const status = parsed.status || (isCompliant ? "COMPLIANT" : "BLOCKED");

      return {
        ...parsed,
        isCompliant,
        status,
        violations: preValidationViolations,
        provider: this.llmProvider.providerId,
        analysisMode: evalResult.mode,
        taskScope: evalResult.scope,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.warn(
        `Fallback to rule template engine due to LLM provider (${this.llmProvider.providerId}) call failure/timeout (${latencyMs}ms): ${(error as Error).message}`,
      );

      // 정규식 매칭 기반 오프라인 룰 템플릿 엔진으로 즉시 조치 가이드 생성
      const fallbackResult = this.ruleTemplateEngine.matchAndGenerate(
        dto,
        latencyMs,
      );

      return {
        ...fallbackResult,
        violations: preValidationViolations,
        analysisMode: evalResult.mode,
        taskScope: evalResult.scope,
      };
    }
  }
}
