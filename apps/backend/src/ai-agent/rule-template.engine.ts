import { Injectable, Logger } from "@nestjs/common";
import * as yaml from "js-yaml";
import {
  ExplainKyvernoErrorDto,
  KyvernoErrorExplanationResultDto,
} from "./dto/explain-error.dto";

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
 * AWS Bedrock 미연결 또는 응답 지연 시 고속 오프라인 해설을 제공하는 규칙 기반 템플릿 엔진
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
}
