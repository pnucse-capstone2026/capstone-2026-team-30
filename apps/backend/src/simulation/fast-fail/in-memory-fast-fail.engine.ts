import { Injectable, Logger } from "@nestjs/common";
import { KubernetesObject } from "@kubernetes/client-node";
import { KyvernoViolationDetail } from "../dto/dry-run-validation.dto";

/**
 * ADR 0008: Tier 1 로컬 인메모리 Fast-Fail 정책 검증 엔진
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
   * 단일 쿠버네티스 리소스 객체에 대해 Tier 1 Fast-Fail 정책을 평가합니다.
   *
   * @param obj 파싱된 쿠버네티스 리소스 객체
   * @returns 발견된 정책 위반 세부 목록 (위반이 없으면 빈 배열 반환)
   */
  evaluateResource(obj: KubernetesObject): KyvernoViolationDetail[] {
    if (!obj || typeof obj !== "object") {
      return [];
    }

    const kind = obj.kind || "";
    if (!this.WORKLOAD_KINDS.has(kind)) {
      return [];
    }

    const violations: KyvernoViolationDetail[] = [];
    const metadata = (obj.metadata || {}) as Record<string, unknown>;
    const labels = (metadata.labels || {}) as Record<string, string>;

    // 1. 필수 표준 라벨 검사 (require-standard-labels)
    if (!labels["app.kubernetes.io/name"]) {
      violations.push({
        policyName: "require-standard-labels",
        ruleName: "check-standard-labels",
        reason:
          "metadata.labels에 'app.kubernetes.io/name' 표준 애플리케이션 식별 라벨이 반드시 지정되어야 합니다.",
        path: "/metadata/labels/app.kubernetes.io~1name",
      });
    }

    // 2. Pod Spec 및 컨테이너 목록 추출
    const { podSpec, containerPrefix } = this.extractPodSpec(kind, obj);
    if (!podSpec) {
      return violations;
    }

    const rawContainers = Array.isArray(podSpec.containers)
      ? (podSpec.containers as Array<Record<string, unknown>>)
      : [];
    const rawInitContainers = Array.isArray(podSpec.initContainers)
      ? (podSpec.initContainers as Array<Record<string, unknown>>)
      : [];
    const containers = [...rawContainers, ...rawInitContainers];

    if (containers.length === 0) {
      return violations;
    }

    const podSecCtx = podSpec.securityContext as
      | Record<string, unknown>
      | undefined;
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
    }

    // 4. 개별 컨테이너 레벨 PSS 룰 검사
    containers.forEach((container, index) => {
      const cSecCtx = container?.securityContext as
        | Record<string, unknown>
        | undefined;
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

      // 4-2. Non-root 실행 검사 (require-non-root-user)
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

      // 4-4. 리소스 limits 누락 검사 (require-resource-limits)
      const resources = container?.resources as
        | Record<string, unknown>
        | undefined;
      const limits = resources?.limits as Record<string, unknown> | undefined;

      if (!limits?.cpu || !limits?.memory) {
        violations.push({
          policyName: "require-resource-limits",
          ruleName: "check-resource-limits",
          reason:
            "모든 컨테이너는 노드 자원 보호를 위해 resources.limits.cpu 및 resources.limits.memory 설정을 요구합니다.",
          path: `${cPrefix}/resources/limits`,
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
    podSpec?: Record<string, unknown>;
    containerPrefix: string;
  } {
    const rawObj = obj as Record<string, unknown>;
    const spec = rawObj.spec as Record<string, unknown> | undefined;

    if (!spec) {
      return { containerPrefix: "/spec/containers" };
    }

    if (kind === "Pod") {
      return {
        podSpec: spec,
        containerPrefix: "/spec/containers",
      };
    }

    if (kind === "CronJob") {
      const jobTemplate = spec.jobTemplate as
        | Record<string, unknown>
        | undefined;
      const jobSpec = jobTemplate?.spec as Record<string, unknown> | undefined;
      const template = jobSpec?.template as Record<string, unknown> | undefined;
      return {
        podSpec: template?.spec as Record<string, unknown> | undefined,
        containerPrefix: "/spec/jobTemplate/spec/template/spec/containers",
      };
    }

    // Deployment, StatefulSet, DaemonSet, Job
    const template = spec.template as Record<string, unknown> | undefined;
    return {
      podSpec: (template?.spec as Record<string, unknown> | undefined) || spec,
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
