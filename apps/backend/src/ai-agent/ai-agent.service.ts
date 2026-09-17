import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  LLM_PROVIDER_TOKEN,
  LlmProvider,
} from "./providers/llm-provider.interface";
import {
  ExplainKyvernoErrorDto,
  KyvernoErrorExplanationResultDto,
} from "./dto/explain-error.dto";
import { KyvernoRuleTemplateEngine } from "./rule-template.engine";
import { WorkloadEvaluatorService } from "./services/workload-evaluator.service";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";

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

    if (!this.kyvernoAdapter) {
      return [];
    }

    const policies =
      (await this.kyvernoAdapter.listClusterPolicies(clusterId)) || [];
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
    if (this.clusterProvider) {
      try {
        const allClusters = this.clusterProvider.list();
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

    if (namespace) {
      lines.push(`- Target Namespace: ${namespace}`);
    }

    if (this.kyvernoAdapter && targetClusterId) {
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
   * Kyverno 정책 위반 오류 메시지 및 K8s 매니페스트 context를 분석하여 쉬운 해설 리포트를 생성합니다.
   * 설정된 LLM 프로바이더 통신에 타임아웃이 발생하거나 실패할 경우 룰 기반 Graceful Fallback 엔진으로 즉각 전환합니다.
   *
   * @param dto Kyverno 오류 메시지, 정책 YAML, 쿠버네티스 매니페스트, 클러스터 상태 정보
   * @returns 쉬운 해설, 단계별 조치 방법, 수정 매니페스트 및 보안 거버넌스 배경
   */
  async explainKyvernoError(
    dto: ExplainKyvernoErrorDto,
  ): Promise<KyvernoErrorExplanationResultDto> {
    const startTime = Date.now();
    const evalResult = this.workloadEvaluator.evaluate(dto);

    const liveContext = await this.buildClusterGovernanceContext(
      dto.clusterId,
      dto.namespace,
    );

    const mergedClusterContext = dto.clusterContext
      ? `${liveContext}\n- Additional Client Context: ${dto.clusterContext}`
      : liveContext;

    const systemPrompt = `You are a world-class, empathetic Kubernetes Platform Engineering AI Assistant.
Your mission is to explain Kyverno policy rejection errors and guide developers to successful deployments.

Target Audience & Tone:
1. For junior developers or users without deep Kubernetes expertise: Explain root causes and terminology using intuitive, plain Korean analogies. Avoid intimidating jargon and provide gentle, step-by-step guidance.
2. For senior engineers and platform administrators: Provide accurate technical rationale, architectural context, and precise Kubernetes specification details.

CRITICAL INSTRUCTION - HOLISTIC CLUSTER POLICY COMPLIANCE:
The cluster enforces multiple simultaneous Kyverno policies (see [Cluster Environment & Active Governance Policies Context]).
When generating "suggestedFixYaml", the corrected manifest MUST satisfy NOT ONLY the specific policy that triggered the rejection, BUT ALSO ALL OTHER ACTIVE CLUSTER POLICIES SIMULTANEOUSLY:
- Image Tags & Registries: When fixing image tags, always use approved registries (e.g. 'public.ecr.aws/<repo>:<version>' or 'registry.k8s.io/<image>:<version>'). Never use ':latest' and avoid unverified Docker Hub root images.
- Mandatory Governance Labels: Ensure 'metadata.labels["app.kubernetes.io/name"]' and 'metadata.labels["team"]' (e.g. team: devops) are present.
- Resource Limits: Ensure container resource limits/requests (e.g. cpu: 100m, memory: 128Mi) are specified if missing.
- Privileged Containers: For critical violations involving 'securityContext.privileged: true', hostNetwork, or hostPID, do NOT provide suggestedFixYaml (set suggestedFixYaml to null). Explain that arbitrary privilege removal breaks workloads requiring raw kernel/device access, and instruct the developer to submit a PolicyException or re-architect the workload safely.

Output format MUST be a valid JSON object matching the following structure without codeblock wrapper or markdown syntax:
{
  "summary": "Easy-to-understand explanation of why the deployment was rejected in Korean",
  "resolutionSteps": ["Step 1 explanation in Korean", "Step 2 explanation in Korean", "..."],
  "suggestedFixYaml": "Valid corrected YAML manifest snippet if applicable (or null if PolicyException required)",
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
${dto.errorMessage}

[Applied Kyverno Policy]
${dto.policyYaml || "N/A"}

[User Submitted Resource Manifest]
${dto.resourceManifest || "N/A"}

[Cluster Environment & Active Governance Policies Context]
${mergedClusterContext}
${feedbackSection}
Please analyze the rejection with full consideration of the cluster context above and generate the JSON response.
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

      return {
        ...parsed,
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
        analysisMode: evalResult.mode,
        taskScope: evalResult.scope,
      };
    }
  }
}
