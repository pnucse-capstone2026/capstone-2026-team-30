import { Injectable, Logger } from "@nestjs/common";
import * as yaml from "js-yaml";
import {
  ExplainKyvernoErrorDto,
  KyvernoErrorExplanationResultDto,
} from "./dto/explain-error.dto";
import { KyvernoViolationDetail } from "../simulation/dto/dry-run-validation.dto";

/**
 * Tier 1 리소스별 선검증 결과
 */
export interface PreValidationResourceResult {
  apiVersion?: string;
  kind?: string;
  name?: string;
  namespace?: string;
  allowed: boolean;
  violations: KyvernoViolationDetail[];
}

/**
 * Tier 1 로컬 인메모리 선검증 종합 결과
 */
export interface PreValidationResult {
  valid: boolean;
  totalResources: number;
  blockedCount: number;
  passedCount: number;
  violations: KyvernoViolationDetail[];
  results: PreValidationResourceResult[];
  latencyMs: number;
  tier: "TIER_1_LOCAL";
}

/**
 * 사전 정의된 정규식 매칭 패턴 및 템플릿 응답 정의 인터페이스
 */
interface RulePatternTemplate {
  id: string;
  pattern: RegExp;
  summary: string;
  resolutionSteps: string[];
  suggestedFixYaml?: string;
  governanceRationale: string;
}

/**
 * AWS Bedrock 미연결 또는 응답 지연 시 고속 오프라인 해설을 제공하고,
 * 2-Tier 정책 게이트의 Tier 1 인메모리 Fast-Fail 검증을 수행하는 규칙 엔진
 */
@Injectable()
export class KyvernoRuleTemplateEngine {
  private readonly logger = new Logger(KyvernoRuleTemplateEngine.name);

  // 사전 정의된 Kyverno 정책 거부 패턴 룰셋
  private readonly templates: RulePatternTemplate[] = [
    {
      id: "DISALLOW_LATEST_TAG",
      pattern: /latest|disallow-latest-tag|tag.*not.*allowed|image.*tag/i,
      summary:
        "컨테이너 이미지 태그가 'latest'로 지정되었거나 고정 태그가 누락되어 배포가 차단되었습니다.",
      resolutionSteps: [
        "Deployment 또는 Pod 매니페스트의 spec.template.spec.containers[].image 항목을 확인합니다.",
        "image: nginx:latest 형태를 image: nginx:1.27.0 과 같이 고정 버전 태그나 SHA digest로 수정합니다.",
        "동일한 이미지 버전을 보장하기 위해 상운영 환경에서는 항상 명시적 태그를 사용해야 합니다.",
      ],
      suggestedFixYaml: `spec:
  template:
    spec:
      containers:
        - name: app
          image: my-registry.domain.com/app:v1.2.0 # 고정 버전 태그 명시`,
      governanceRationale:
        "latest 태그는 시점에 따라 서로 다른 이미지를 불러와 예측할 수 없는 장애나 재현 불가능한 버그를 유발하므로 정밀한 가시성을 위해 사용이 금지됩니다.",
    },
    {
      id: "REQUIRE_RESOURCE_LIMITS",
      pattern:
        /limit|limits|cpu|memory|require-resource-limits|resource.*request/i,
      summary:
        "컨테이너에 CPU 또는 메모리 리소스 상한선(limits) 및 요청량(requests)이 설정되지 않았습니다.",
      resolutionSteps: [
        "spec.template.spec.containers[].resources 구문을 추가합니다.",
        "requests(최소 요구량) 및 limits(최대 사용량)에 cpu와 memory 한도를 명시합니다.",
        "애플리케이션 예상 부하에 따라 적절한 메모리(M/Gi)와 CPU(m) 스펙을 지정하세요.",
      ],
      suggestedFixYaml: `spec:
  template:
    spec:
      containers:
        - name: app
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"`,
      governanceRationale:
        "무제한 자원 사용으로 인한 인접 워크로드의 OOMKilled(메모리 부족 종료) 현상 및 클러스터 노드 고갈을 방지하기 위해 필수적으로 요구됩니다.",
    },
    {
      id: "DISALLOW_PRIVILEGED",
      pattern:
        /privileged|securityContext|disallow-privileged-containers|disallow-privileged|capability/i,
      summary:
        "보안상 매우 위험한 Privileged(특권 권한) 모드로 컨테이너를 실행하려 하여 배포가 거부되었습니다. 특권 권한은 시스템에 심각한 위해를 초래할 수 있어 자동 교정이 제한됩니다.",
      resolutionSteps: [
        "spec.template.spec.containers[].securityContext 설정을 확인합니다.",
        "privileged: true 구문을 제거하거나 false로 지정합니다.",
        "해당 컨테이너에 특권 권한이 불가피하게 필요한 경우, 플랫폼 거버넌스 팀에 PolicyException(정책 예외)을 신청하세요.",
      ],
      suggestedFixYaml: undefined,
      governanceRationale:
        "Privileged 컨테이너가 탈옥당할 경우 호스트 노드의 모든 루트 권한이 노출되어 클러스터 전체가 장악될 수 있는 치명적 보안 위험을 차단합니다.",
    },
    {
      id: "READONLY_ROOT_FS",
      pattern:
        /rootfs|read-only|readOnlyRootFilesystem|require-read-only-rootfs/i,
      summary:
        "컨테이너 루트 파일시스템이 읽기 전용(Read-Only)으로 설정되지 않아 배포가 거부되었습니다.",
      resolutionSteps: [
        "spec.template.spec.containers[].securityContext 설정을 확인합니다.",
        "readOnlyRootFilesystem: true 구문을 추가합니다.",
        "임시 파일 쓰기가 필요한 경우 emptyDir 볼륨을 마운트하여 /tmp 경로에 마운트해 사용하세요.",
      ],
      suggestedFixYaml: `spec:
  template:
    spec:
      containers:
        - name: app
          securityContext:
            readOnlyRootFilesystem: true
          volumeMounts:
            - name: tmp-volume
              mountPath: /tmp
      volumes:
        - name: tmp-volume
          emptyDir: {}`,
      governanceRationale:
        "공격자가 런타임에 악성 코드나 스크립트를 파일시스템에 인젝션하는 것을 원천 차단하기 위한 컨테이너 불변성(Immutability) 강화 정책입니다.",
    },
    {
      id: "REQUIRE_LABELS",
      pattern: /label|labels|team|owner|require-team-label|require-labels/i,
      summary:
        "리소스에 필수 식별 라벨(예: team, owner)이 지정되지 않아 배포가 차단되었습니다.",
      resolutionSteps: [
        "metadata.labels 하위에 지정된 필수 라벨 키/값 쌍을 추가합니다.",
        "예: team: platform 또는 owner: dev-team-a 라벨을 명시하세요.",
      ],
      suggestedFixYaml: `metadata:
  labels:
    team: devops
    app.kubernetes.io/name: my-app`,
      governanceRationale:
        "클러스터 내 비용 추적(Cost Allocation), 장애 발생 시 담당 팀 자동 알림, 접근 제어를 위해 모든 워크로드의 소유권을 명확히 관리합니다.",
    },
    {
      id: "RESTRICT_REGISTRIES",
      pattern:
        /registry|registries|restrict-image-registries|disallowed.*registry/i,
      summary:
        "승인되지 않은 외부 컨테이너 레지스트리의 이미지를 사용하여 배포가 거부되었습니다.",
      resolutionSteps: [
        "이미지 경로를 승인된 사내 ECR 레지스트리 주소로 수정합니다.",
        "허용된 예시: 123456789012.dkr.ecr.us-east-1.amazonaws.com/your-repo:tag",
      ],
      suggestedFixYaml: `spec:
  template:
    spec:
      containers:
        - name: app
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-service:v1.0.0`,
      governanceRationale:
        "검증되지 않은 외부 공개 레지스트리(DockerHub 등)의 악성 코드 포함 이미지 및 Supply Chain 공격을 예방하기 위해 허용된 레지스트리만 승인합니다.",
    },
  ];

  /**
   * 입력받은 오류 메시지를 정규식 패턴과 매칭하여 가장 적합한 템플릿 응답을 반환합니다.
   *
   * @param dto 오류 메시지 및 매니페스트 DTO
   * @param latencyMs 소요 시간
   */
  matchAndGenerate(
    dto: ExplainKyvernoErrorDto,
    latencyMs = 0,
  ): KyvernoErrorExplanationResultDto {
    const errorMsg = dto.errorMessage || "";

    for (const template of this.templates) {
      if (template.pattern.test(errorMsg)) {
        this.logger.log(
          `Rule engine matched pattern [${template.id}] for error message`,
        );

        let suggestedFixYaml = template.suggestedFixYaml;

        // 원본 매니페스트가 주어졌고 필수 라벨 누락 위반인 경우, 원본 YAML에 필수 라벨을 직접 주입하여 완전한 수정본 매니페스트 생성
        if (template.id === "REQUIRE_LABELS" && dto.resourceManifest) {
          try {
            const parsed = yaml.load(dto.resourceManifest) as Record<
              string,
              unknown
            >;
            if (parsed && typeof parsed === "object") {
              parsed.metadata = (parsed.metadata || {}) as Record<
                string,
                unknown
              >;
              const metadata = parsed.metadata as Record<string, unknown>;
              metadata.labels = (metadata.labels || {}) as Record<
                string,
                string
              >;
              const labels = metadata.labels as Record<string, string>;

              const resourceName =
                (metadata.name as string) || "governed-workload";
              if (!labels["app.kubernetes.io/name"]) {
                labels["app.kubernetes.io/name"] = resourceName;
              }
              if (!labels["team"]) {
                labels["team"] = "platform";
              }

              suggestedFixYaml = yaml.dump(parsed);
            }
          } catch {
            suggestedFixYaml = template.suggestedFixYaml;
          }
        }

        return {
          summary: template.summary,
          resolutionSteps: template.resolutionSteps,
          suggestedFixYaml,
          governanceRationale: template.governanceRationale,
          provider: "RULE_ENGINE_FALLBACK",
          latencyMs,
        };
      }
    }

    // 일치하는 정규식 패턴이 없을 경우 기본 다이내믹 템플릿 반환
    this.logger.log(
      "No specific pattern matched. Returning default dynamic template.",
    );
    return {
      summary: `Kyverno 거버넌스 정책에 의해 배포 요청이 거부되었습니다: ${errorMsg}`,
      resolutionSteps: [
        "거부 오류 메시지에 명시된 룰(Rule) 요구사항 및 필드 스펙을 확인합니다.",
        "매니페스트의 spec 하위 설정 또는 필수 라벨/보안 설정을 수정 후 재배포하세요.",
        "필요한 경우 플랫폼 팀에 사유를 입력하여 임시 PolicyException(정책 예외)을 신청하세요.",
      ],
      suggestedFixYaml: dto.resourceManifest
        ? `# 검토 필요 매니페스트\n${dto.resourceManifest}`
        : undefined,
      governanceRationale:
        "안정적이고 규정된 표준 쿠버네티스 멀티클러스터 가버넌스를 준수하기 위한 보안 검증 정책입니다.",
      provider: "RULE_ENGINE_FALLBACK",
      latencyMs,
    };
  }

  /**
   * Tier 1 로컬 인메모리 정적 선검증 (Fast-Fail)
   *
   * K8s API Server 및 Kyverno Admission Webhook 네트워크 호출 전,
   * 필수 레이블, privileged 컨테이너, root 실행, 리소스 limits/requests 누락 등
   * 빈번한 정형화된 정책 위반을 수 밀리초(<= 5ms) 내에 고속 판별합니다.
   *
   * @param manifestYaml 쿠버네티스 YAML 매니페스트 (단일 또는 다중 문서)
   * @returns Tier 1 검증 결과 및 발견된 위반 목록
   */
  preValidateManifest(manifestYaml: string): PreValidationResult {
    const startTime = performance.now();
    const workloadKinds = [
      "Pod",
      "Deployment",
      "StatefulSet",
      "DaemonSet",
      "Job",
      "CronJob",
    ];

    let docs: Array<Record<string, unknown>> = [];
    try {
      docs = (yaml.loadAll(manifestYaml) || []).filter(
        (d): d is Record<string, unknown> =>
          Boolean(d && typeof d === "object"),
      );
    } catch (err) {
      const latencyMs = Number((performance.now() - startTime).toFixed(2));
      const syntaxViolation: KyvernoViolationDetail = {
        policyName: "yaml-syntax-error",
        ruleName: "valid-yaml",
        reason: `YAML 매니페스트 구문 오류: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
      return {
        valid: false,
        totalResources: 1,
        blockedCount: 1,
        passedCount: 0,
        violations: [syntaxViolation],
        results: [
          {
            apiVersion: "unknown",
            kind: "Unknown",
            name: "malformed",
            allowed: false,
            violations: [syntaxViolation],
          },
        ],
        latencyMs,
        tier: "TIER_1_LOCAL",
      };
    }

    if (docs.length === 0) {
      const latencyMs = Number((performance.now() - startTime).toFixed(2));
      if (manifestYaml.trim().length > 0) {
        const syntaxViolation: KyvernoViolationDetail = {
          policyName: "yaml-syntax-error",
          ruleName: "valid-k8s-manifest",
          reason:
            "YAML 매니페스트에 유효한 쿠버네티스 리소스 객체가 정의되어 있지 않습니다.",
        };
        return {
          valid: false,
          totalResources: 0,
          blockedCount: 1,
          passedCount: 0,
          violations: [syntaxViolation],
          results: [],
          latencyMs,
          tier: "TIER_1_LOCAL",
        };
      }
      return {
        valid: true,
        totalResources: 0,
        blockedCount: 0,
        passedCount: 0,
        violations: [],
        results: [],
        latencyMs,
        tier: "TIER_1_LOCAL",
      };
    }

    const allViolations: KyvernoViolationDetail[] = [];
    const resourceResults: PreValidationResourceResult[] = [];
    let blockedCount = 0;

    for (const doc of docs) {
      const apiVersion = doc.apiVersion ? String(doc.apiVersion) : undefined;
      const kind = doc.kind ? String(doc.kind) : "";
      const name = doc.metadata?.name ? String(doc.metadata.name) : "unnamed";
      const namespace = doc.metadata?.namespace
        ? String(doc.metadata.namespace)
        : undefined;
      const labels = (doc.metadata?.labels || {}) as Record<string, string>;

      const resourceViolations: KyvernoViolationDetail[] = [];

      // 쿠버네티스 표준 스펙 검증: apiVersion 및 kind 필수
      if (!apiVersion || !kind) {
        resourceViolations.push({
          policyName: "yaml-syntax-error",
          ruleName: "valid-k8s-manifest",
          reason:
            "유효한 쿠버네티스 리소스는 apiVersion 및 kind 항목을 반드시 포함해야 합니다.",
          path: "/kind",
        });
      }

      const isWorkload = workloadKinds.includes(kind);

      if (isWorkload) {
        // 1. 필수 레이블 검증 (require-labels)
        const hasAppName = Boolean(
          labels["app.kubernetes.io/name"] || labels["app"],
        );
        const hasTeam = Boolean(labels["team"] || labels["owner"]);
        if (!hasAppName || !hasTeam) {
          resourceViolations.push({
            policyName: "require-labels",
            ruleName: "check-for-labels",
            reason:
              "metadata.labels에 'app.kubernetes.io/name' 및 'team' 레이블이 반드시 지정되어야 합니다.",
            path: "/metadata/labels",
          });
        }

        // 컨테이너 목록 추출
        let podSpec: Record<string, unknown> | undefined = undefined;
        let containerPrefix = "/spec/containers";
        const spec = doc.spec as Record<string, unknown> | undefined;
        if (kind === "Pod") {
          podSpec = spec;
          containerPrefix = "/spec/containers";
        } else if (kind === "CronJob") {
          const jobTemplate = spec?.jobTemplate as
            | Record<string, unknown>
            | undefined;
          const jobSpec = jobTemplate?.spec as
            | Record<string, unknown>
            | undefined;
          const template = jobSpec?.template as
            | Record<string, unknown>
            | undefined;
          podSpec = template?.spec as Record<string, unknown> | undefined;
          containerPrefix = "/spec/jobTemplate/spec/template/spec/containers";
        } else {
          const template = spec?.template as
            | Record<string, unknown>
            | undefined;
          podSpec =
            (template?.spec as Record<string, unknown> | undefined) || spec;
          containerPrefix = template?.spec
            ? "/spec/template/spec/containers"
            : "/spec/containers";
        }

        const rawContainers = Array.isArray(podSpec?.containers)
          ? (podSpec?.containers as Array<Record<string, unknown>>)
          : [];
        const rawInitContainers = Array.isArray(podSpec?.initContainers)
          ? (podSpec?.initContainers as Array<Record<string, unknown>>)
          : [];
        const containers = [...rawContainers, ...rawInitContainers];

        if (containers.length > 0) {
          // 2. Privileged 컨테이너 차단 (disallow-privileged-containers)
          for (let i = 0; i < containers.length; i++) {
            const c = containers[i];
            const secCtx = c?.securityContext as
              | Record<string, unknown>
              | undefined;
            if (secCtx?.privileged === true) {
              resourceViolations.push({
                policyName: "disallow-privileged-containers",
                ruleName: "disallow-privileged-containers",
                reason:
                  "privileged: true 옵션이 설정된 특권 컨테이너는 보안 정책상 실행될 수 없습니다.",
                path: `${containerPrefix}/${i}/securityContext/privileged`,
              });
            }
          }

          // 3. root 권한 실행 차단 (require-run-as-non-root)
          const podSecCtx = podSpec?.securityContext as
            | Record<string, unknown>
            | undefined;
          const podRunAsNonRoot = podSecCtx?.runAsNonRoot === true;
          const podRunAsUserZero = podSecCtx?.runAsUser === 0;

          if (podRunAsUserZero) {
            resourceViolations.push({
              policyName: "require-run-as-non-root",
              ruleName: "run-as-non-root",
              reason: "컨테이너는 root 권한(UID 0)으로 실행될 수 없습니다.",
              path: "/spec/template/spec/securityContext/runAsUser",
            });
          } else {
            for (let i = 0; i < containers.length; i++) {
              const c = containers[i];
              const cSecCtx = c?.securityContext as
                | Record<string, unknown>
                | undefined;
              const containerRunAsUserZero = cSecCtx?.runAsUser === 0;
              const containerRunAsNonRoot = cSecCtx?.runAsNonRoot === true;
              const isExplicitFalse = cSecCtx?.runAsNonRoot === false;

              if (containerRunAsUserZero) {
                resourceViolations.push({
                  policyName: "require-run-as-non-root",
                  ruleName: "run-as-non-root",
                  reason: "컨테이너는 root 권한(UID 0)으로 실행될 수 없습니다.",
                  path: `${containerPrefix}/${i}/securityContext/runAsUser`,
                });
              } else if (
                isExplicitFalse ||
                (!podRunAsNonRoot && !containerRunAsNonRoot)
              ) {
                resourceViolations.push({
                  policyName: "require-run-as-non-root",
                  ruleName: "run-as-non-root",
                  reason:
                    "컨테이너는 root 권한으로 실행될 수 없습니다. securityContext.runAsNonRoot: true 설정을 요구합니다.",
                  path: `${containerPrefix}/${i}/securityContext/runAsNonRoot`,
                });
              }
            }
          }

          // 4. 리소스 requests/limits 누락 검증 (require-pod-requests-limits)
          for (let i = 0; i < containers.length; i++) {
            const c = containers[i];
            const res = c?.resources as Record<string, unknown> | undefined;
            const req = res?.requests as Record<string, unknown> | undefined;
            const lim = res?.limits as Record<string, unknown> | undefined;
            if (!req?.cpu || !req?.memory || !lim?.cpu || !lim?.memory) {
              resourceViolations.push({
                policyName: "require-pod-requests-limits",
                ruleName: "validate-resource-requests-limits",
                reason:
                  "모든 컨테이너는 CPU/Memory의 requests 및 limits 설정을 요구합니다.",
                path: `${containerPrefix}/${i}/resources`,
              });
            }
          }
        }
      }

      const isAllowed = resourceViolations.length === 0;
      if (!isAllowed) {
        blockedCount++;
        allViolations.push(...resourceViolations);
      }

      resourceResults.push({
        apiVersion,
        kind,
        name,
        namespace,
        allowed: isAllowed,
        violations: resourceViolations,
      });
    }

    const latencyMs = Number((performance.now() - startTime).toFixed(2));
    return {
      valid: allViolations.length === 0,
      totalResources: docs.length,
      blockedCount,
      passedCount: docs.length - blockedCount,
      violations: allViolations,
      results: resourceResults,
      latencyMs,
      tier: "TIER_1_LOCAL",
    };
  }
}
