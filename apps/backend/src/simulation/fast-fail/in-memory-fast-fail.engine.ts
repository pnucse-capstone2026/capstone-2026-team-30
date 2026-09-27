import { Injectable, Logger } from "@nestjs/common";
import {
  KubernetesObject,
  V1Container,
  V1PodSpec,
  V1SecurityContext,
  V1ResourceRequirements,
} from "@kubernetes/client-node";
import * as yaml from "js-yaml";
import { KyvernoViolationDetail } from "../dto/dry-run-validation.dto";

/**
 * 값이 null이나 배열이 아닌 일반 객체(Record)인지 판별하는 타입 가드
 *
 * @param val 판별할 대상 값
 * @returns 객체 여부
 */
export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * 값이 유효한 KubernetesObject 객체인지 판별하는 타입 가드
 *
 * @param val 판별할 대상 값
 * @returns KubernetesObject 여부
 */
export function isKubernetesObject(val: unknown): val is KubernetesObject {
  return isRecord(val);
}

/**
 * 값이 유효한 V1PodSpec 객체인지 판별하는 타입 가드
 *
 * @param val 판별할 대상 값
 * @returns V1PodSpec 여부
 */
export function isPodSpec(val: unknown): val is V1PodSpec {
  return isRecord(val);
}

/**
 * PodSpec 객체로부터 컨테이너(containers 및 initContainers) 목록을 안전하게 추출
 *
 * @param podSpec PodSpec 또는 미정의 객체
 * @returns 안전하게 필터링된 V1Container 배열
 */
export function extractContainers(
  podSpec: V1PodSpec | undefined,
): V1Container[] {
  if (!podSpec || !isRecord(podSpec)) {
    return [];
  }
  const rawContainers = Array.isArray(podSpec.containers)
    ? podSpec.containers.filter((c): c is V1Container => isRecord(c))
    : [];
  const rawInitContainers = Array.isArray(podSpec.initContainers)
    ? podSpec.initContainers.filter((c): c is V1Container => isRecord(c))
    : [];
  return [...rawContainers, ...rawInitContainers];
}

/**
 * 값이 유효한 V1SecurityContext 객체인지 판별하는 타입 가드
 *
 * @param val 판별할 대상 값
 * @returns V1SecurityContext 여부
 */
export function isSecurityContext(val: unknown): val is V1SecurityContext {
  return isRecord(val);
}

/**
 * 값이 유효한 V1ResourceRequirements 객체인지 판별하는 타입 가드
 *
 * @param val 판별할 대상 값
 * @returns V1ResourceRequirements 여부
 */
export function isResourceRequirements(
  val: unknown,
): val is V1ResourceRequirements {
  return isRecord(val);
}

/**
 * Tier 1 리소스별 선검증 결과 인터페이스
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
 * Tier 1 로컬 인메모리 선검증 종합 결과 인터페이스
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
 * ADR 0008: Tier 1 로컬 인메모리 Fast-Fail 정책 검증 엔진 (Single Source of Truth)
 *
 * K8s Admission Webhook 호출 전, 정형화된 Pod Security Standards (PSS) 및
 * 플랫폼 표준 거버넌스 룰(Privileged, Root 실행, 리소스 상한선, Latest 태그, 필수 라벨 등)을
 * 순수 인메모리 AST/객체 순회로 1~3ms 내에 고속 평가하여 웹훅 부하를 선제 차단합니다.
 */
@Injectable()
export class InMemoryFastFailEngine {
  private readonly logger = new Logger(InMemoryFastFailEngine.name);

  // 인메모리 검증 대상 워크로드 리소스 종류
  private readonly WORKLOAD_KINDS = new Set([
    "Pod",
    "Deployment",
    "StatefulSet",
    "DaemonSet",
    "Job",
    "CronJob",
  ]);

  /**
   * 단일 또는 다중 YAML 매니페스트를 파싱하여 모든 워크로드 리소스에 대해 Tier 1 Fast-Fail 정책을 종합 평가합니다.
   *
   * @param manifestYaml 단일 또는 다중 쿠버네티스 리소스 매니페스트 YAML 문자열
   * @returns 종합 선검증 결과
   */
  preValidateManifest(manifestYaml: string): PreValidationResult {
    const startTime = performance.now();

    if (!manifestYaml || !manifestYaml.trim()) {
      const latencyMs = Number((performance.now() - startTime).toFixed(2));
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

    let parsedDocs: unknown[] = [];
    try {
      parsedDocs = yaml.loadAll(manifestYaml) || [];
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

    const docs = parsedDocs.filter(isRecord);

    if (docs.length === 0) {
      const latencyMs = Number((performance.now() - startTime).toFixed(2));
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

    const allViolations: KyvernoViolationDetail[] = [];
    const resourceResults: PreValidationResourceResult[] = [];
    let blockedCount = 0;

    for (const doc of docs) {
      const apiVersion =
        typeof doc.apiVersion === "string" ? doc.apiVersion : undefined;
      const kind = typeof doc.kind === "string" ? doc.kind : "";
      const metadata = isRecord(doc.metadata) ? doc.metadata : {};
      const name =
        typeof metadata.name === "string" ? metadata.name : "unnamed";
      const namespace =
        typeof metadata.namespace === "string" ? metadata.namespace : undefined;

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
      } else {
        // 단일 리소스 객체 평가 (evaluateResource 위임)
        const violations = this.evaluateResource(doc);
        resourceViolations.push(...violations);
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

  /**
   * 단일 쿠버네티스 리소스 객체에 대해 Tier 1 Fast-Fail 정책을 평가합니다.
   *
   * @param obj 파싱된 쿠버네티스 리소스 객체
   * @returns 발견된 정책 위반 세부 목록 (위반이 없으면 빈 배열 반환)
   */
  evaluateResource(obj: KubernetesObject): KyvernoViolationDetail[] {
    if (!isRecord(obj)) {
      return [];
    }

    const kind = typeof obj.kind === "string" ? obj.kind : "";
    if (!this.WORKLOAD_KINDS.has(kind)) {
      return [];
    }

    const violations: KyvernoViolationDetail[] = [];
    const metadata = isRecord(obj.metadata) ? obj.metadata : {};
    const labels = isRecord(metadata.labels) ? metadata.labels : {};

    // 1. 필수 표준 라벨 검사 (require-standard-labels 및 require-labels)
    const hasAppName = Boolean(
      labels["app.kubernetes.io/name"] || labels["app"],
    );
    const hasTeam = Boolean(labels["team"] || labels["owner"]);

    if (!hasAppName) {
      violations.push({
        policyName: "require-standard-labels",
        ruleName: "check-standard-labels",
        reason:
          "metadata.labels에 'app.kubernetes.io/name' 표준 애플리케이션 식별 라벨이 반드시 지정되어야 합니다.",
        path: "/metadata/labels/app.kubernetes.io~1name",
      });
    }

    if (!hasTeam) {
      violations.push({
        policyName: "require-labels",
        ruleName: "check-for-labels",
        reason:
          "metadata.labels에 'team' 또는 'owner' 소유권 식별 라벨이 반드시 지정되어야 합니다.",
        path: "/metadata/labels/team",
      });
    }

    // 2. Pod Spec 및 컨테이너 목록 추출
    const { podSpec, containerPrefix } = this.extractPodSpec(kind, obj);
    if (!podSpec) {
      return violations;
    }

    const containers = extractContainers(podSpec);
    if (containers.length === 0) {
      return violations;
    }

    const podSecCtx = isSecurityContext(podSpec.securityContext)
      ? podSpec.securityContext
      : undefined;
    const podRunAsUserZero = podSecCtx?.runAsUser === 0;
    const podRunAsNonRoot = podSecCtx?.runAsNonRoot === true;

    // 3. Pod 레벨 Root 권한 실행 검사
    if (podRunAsUserZero) {
      violations.push({
        policyName: "require-non-root-user",
        ruleName: "check-run-as-non-root",
        reason:
          "Pod 레벨 securityContext에 root 권한(UID 0)으로 실행될 수 없습니다.",
        path: "/spec/template/spec/securityContext/runAsUser",
      });
      violations.push({
        policyName: "require-run-as-non-root",
        ruleName: "run-as-non-root",
        reason: "컨테이너는 root 권한(UID 0)으로 실행될 수 없습니다.",
        path: "/spec/template/spec/securityContext/runAsUser",
      });
    }

    // 4. 개별 컨테이너 레벨 PSS 룰 검사
    containers.forEach((container, index) => {
      const cSecCtx = isSecurityContext(container.securityContext)
        ? container.securityContext
        : undefined;
      const cPrefix = `${containerPrefix}/${index}`;

      // 4-1. 특권(Privileged) 컨테이너 차단 검사 (disallow-privileged-containers)
      if (cSecCtx?.privileged === true) {
        violations.push({
          policyName: "disallow-privileged-containers",
          ruleName: "disallow-privileged-containers",
          reason:
            "privileged: true 옵션이 설정된 특권 컨테이너는 클러스터 보안 정책상 허용되지 않습니다.",
          path: `${cPrefix}/securityContext/privileged`,
        });
      }

      // 4-2. Non-root 실행 검사 (require-non-root-user / require-run-as-non-root)
      const containerRunAsUserZero = cSecCtx?.runAsUser === 0;
      const containerRunAsNonRoot = cSecCtx?.runAsNonRoot === true;
      const isExplicitFalse = cSecCtx?.runAsNonRoot === false;

      if (containerRunAsUserZero) {
        violations.push({
          policyName: "require-non-root-user",
          ruleName: "check-run-as-non-root",
          reason: "컨테이너는 root 권한(UID 0)으로 실행될 수 없습니다.",
          path: `${cPrefix}/securityContext/runAsUser`,
        });
        violations.push({
          policyName: "require-run-as-non-root",
          ruleName: "run-as-non-root",
          reason: "컨테이너는 root 권한(UID 0)으로 실행될 수 없습니다.",
          path: `${cPrefix}/securityContext/runAsUser`,
        });
      } else if (
        isExplicitFalse ||
        (!podRunAsNonRoot && !containerRunAsNonRoot)
      ) {
        violations.push({
          policyName: "require-non-root-user",
          ruleName: "check-run-as-non-root",
          reason:
            "컨테이너는 root 권한으로 실행될 수 없습니다. securityContext.runAsNonRoot: true 설정을 요구합니다.",
          path: `${cPrefix}/securityContext/runAsNonRoot`,
        });
        violations.push({
          policyName: "require-run-as-non-root",
          ruleName: "run-as-non-root",
          reason:
            "컨테이너는 root 권한으로 실행될 수 없습니다. securityContext.runAsNonRoot: true 설정을 요구합니다.",
          path: `${cPrefix}/securityContext/runAsNonRoot`,
        });
      }

      // 4-3. 최신(:latest) 태그 및 태그 생략 차단 검사 (disallow-latest-tag)
      const image =
        typeof container.image === "string" ? container.image.trim() : "";
      if (this.isLatestOrMissingTag(image)) {
        violations.push({
          policyName: "disallow-latest-tag",
          ruleName: "require-image-tag",
          reason:
            "컨테이너 이미지에 'latest' 태그를 사용하거나 태그를 생략할 수 없으며 고정 버전 태그가 필요합니다.",
          path: `${cPrefix}/image`,
        });
      }

      // 4-4. 리소스 limits/requests 누락 검사 (require-resource-limits / require-pod-requests-limits)
      const resources = isResourceRequirements(container.resources)
        ? container.resources
        : undefined;
      const limits = isRecord(resources?.limits) ? resources.limits : undefined;
      const requests = isRecord(resources?.requests)
        ? resources.requests
        : undefined;

      if (!limits?.cpu || !limits?.memory) {
        violations.push({
          policyName: "require-resource-limits",
          ruleName: "check-resource-limits",
          reason:
            "모든 컨테이너는 노드 자원 보호를 위해 resources.limits.cpu 및 resources.limits.memory 설정을 요구합니다.",
          path: `${cPrefix}/resources/limits`,
        });
      }

      if (
        !requests?.cpu ||
        !requests?.memory ||
        !limits?.cpu ||
        !limits?.memory
      ) {
        violations.push({
          policyName: "require-pod-requests-limits",
          ruleName: "validate-resource-requests-limits",
          reason:
            "모든 컨테이너는 CPU/Memory의 requests 및 limits 설정을 요구합니다.",
          path: `${cPrefix}/resources`,
        });
      }
    });

    return violations;
  }

  /**
   * 리소스 종류에 따라 적절한 PodSpec 및 컨테이너 경로 프리픽스를 추출합니다.
   */
  private extractPodSpec(
    kind: string,
    obj: KubernetesObject,
  ): {
    podSpec?: V1PodSpec;
    containerPrefix: string;
  } {
    if (!isRecord(obj)) {
      return { containerPrefix: "/spec/containers" };
    }

    const spec = isRecord(obj.spec) ? obj.spec : undefined;

    if (!spec) {
      return { containerPrefix: "/spec/containers" };
    }

    if (kind === "Pod") {
      return {
        podSpec: isPodSpec(spec) ? spec : undefined,
        containerPrefix: "/spec/containers",
      };
    }

    if (kind === "CronJob") {
      const jobTemplate = isRecord(spec.jobTemplate)
        ? spec.jobTemplate
        : undefined;
      const jobSpec = isRecord(jobTemplate?.spec)
        ? jobTemplate.spec
        : undefined;
      const template = isRecord(jobSpec?.template)
        ? jobSpec.template
        : undefined;
      const podSpec = isPodSpec(template?.spec) ? template.spec : undefined;
      return {
        podSpec,
        containerPrefix: "/spec/jobTemplate/spec/template/spec/containers",
      };
    }

    // Deployment, StatefulSet, DaemonSet, Job
    const template = isRecord(spec.template) ? spec.template : undefined;
    const podSpec = isPodSpec(template?.spec)
      ? template.spec
      : isPodSpec(spec)
        ? spec
        : undefined;
    return {
      podSpec,
      containerPrefix: template?.spec
        ? "/spec/template/spec/containers"
        : "/spec/containers",
    };
  }

  /**
   * 컨테이너 이미지가 :latest 태그이거나 태그가 생략되었는지 판별합니다.
   * SHA-256 다이제스트(@sha256:...)가 명시된 경우는 고정 불변 이미지로 허용합니다.
   */
  private isLatestOrMissingTag(image: string): boolean {
    if (!image) {
      return true;
    }

    // SHA-256 다이제스트 명시 시 고정 이미지로 인정
    if (image.includes("@sha256:")) {
      return false;
    }

    // 레지스트리 호스트명:포트 (예: localhost:5000/my-app) 처리
    const lastSlash = image.lastIndexOf("/");
    const imagePart = lastSlash !== -1 ? image.substring(lastSlash + 1) : image;

    // 콜론(:)이 없으면 태그 생략(기본 latest 적용)으로 간주
    if (!imagePart.includes(":")) {
      return true;
    }

    const tag = imagePart.substring(imagePart.lastIndexOf(":") + 1);
    return tag === "latest";
  }
}
