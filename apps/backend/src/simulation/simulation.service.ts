import { Injectable, Logger } from "@nestjs/common";
import { CoreV1Api, V1Pod } from "@kubernetes/client-node";
import * as yaml from "js-yaml";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { BusinessException } from "../common/errors/business.exception";
import { SIMULATION_ERROR } from "./simulation.errors";
import {
  DeploySimulationDto,
  SimulationDeployResult,
  SimulationScenario,
} from "./dto/deploy-simulation.dto";

/**
 * 거버넌스 정책 시뮬레이션 및 테스트베드 관리 서비스
 *
 * 사용자가 사전에 정의된 위반/준수 리소스 또는 커스텀 YAML을 실시간 배포하여
 * Kyverno 어드미션 웹훅 차단 및 정책 위반 감사를 테스트할 수 있도록 지원합니다.
 */
@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  // 시뮬레이션 파드 식별용 전용 라벨
  private readonly TESTBED_LABEL_KEY = "governance.kyverno.io/simulation";
  private readonly TESTBED_LABEL_VALUE = "true";

  // 사전 정의된 시뮬레이션 시나리오 카탈로그
  private readonly SCENARIOS: SimulationScenario[] = [
    {
      id: "disallow-latest-tag",
      title: "1. 최신(:latest) 태그 사용 파드 배포 (차단 검증)",
      category: "Best Practice",
      severity: "HIGH",
      targetPolicy: "disallow-latest-tag",
      expectedResult: "BLOCKED",
      description:
        "컨테이너 이미지에 명시적 버전 대신 ':latest' 태그를 사용한 워크로드입니다. Kyverno 어드미션 컨트롤러에 의해 입구 단계에서 즉시 배포가 차단(Denied)됩니다.",
      namespace: "governance-testbed",
      yaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-tag-violation-latest
  namespace: governance-testbed
  labels:
    app: simulation-test
spec:
  restartPolicy: Never
  containers:
    - name: test-container
      image: registry.k8s.io/pause:latest
      resources:
        limits:
          cpu: 50m
          memory: 64Mi
`,
    },
    {
      id: "disallow-privileged",
      title: "2. 특권(Privileged) 컨테이너 배포 (감사 위반 검증)",
      category: "Pod Security",
      severity: "CRITICAL",
      targetPolicy: "disallow-privileged-containers",
      expectedResult: "AUDIT_VIOLATION",
      description:
        "securityContext.privileged가 true로 설정된 파드입니다. Audit 모드 정책에 의해 배포는 성공하지만 비동기로 정책 위반 보고서(PolicyReport)가 생성됩니다.",
      namespace: "governance-testbed",
      yaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-priv-violation-pod
  namespace: governance-testbed
  labels:
    app: simulation-test
spec:
  restartPolicy: Never
  containers:
    - name: test-container
      image: registry.k8s.io/pause:3.10
      securityContext:
        privileged: true
      resources:
        limits:
          cpu: 50m
          memory: 64Mi
`,
    },
    {
      id: "missing-resource-limits",
      title: "3. CPU/메모리 한도 미설정 워크로드 배포 (FinOps 감사)",
      category: "Cost & Reliability",
      severity: "MEDIUM",
      targetPolicy: "require-resource-limits",
      expectedResult: "AUDIT_VIOLATION",
      description:
        "resources.limits가 정의되지 않아 노드 자원 고갈 위험이 있는 파드입니다. Audit 모드로 배포 후 위반 보고서에 수집됩니다.",
      namespace: "governance-testbed",
      yaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-missing-limits-pod
  namespace: governance-testbed
  labels:
    app: simulation-test
spec:
  restartPolicy: Never
  containers:
    - name: test-container
      image: registry.k8s.io/pause:3.10
`,
    },
    {
      id: "compliant-workload",
      title: "4. 모든 거버넌스 규격 준수 정상 파드 배포 (성공 검증)",
      category: "Compliant",
      severity: "INFO",
      targetPolicy: "none",
      expectedResult: "PASSED",
      description:
        "명시적 태그, 보안 컨텍스트, 자원 한도를 모두 충족하는 모범 규격 파드입니다. 어드미션 통과 및 감사 위반 없이 정상 실행됩니다.",
      namespace: "governance-testbed",
      yaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-compliant-pod
  namespace: governance-testbed
  labels:
    app: simulation-test
spec:
  restartPolicy: Never
  containers:
    - name: test-container
      image: registry.k8s.io/pause:3.10
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
        limits:
          cpu: 50m
          memory: 64Mi
      securityContext:
        privileged: false
        allowPrivilegeEscalation: false
`,
    },
  ];

  constructor(private readonly clusterProvider: ClusterProvider) {}

  /**
   * 사전 정의된 시뮬레이션 시나리오 목록을 반환합니다.
   */
  getScenarios(): SimulationScenario[] {
    return this.SCENARIOS;
  }

  /**
   * Kubernetes CoreV1Api 클라이언트를 생성합니다.
   */
  private getCoreV1Api(clusterId = "default"): CoreV1Api {
    const kubeConfig = this.clusterProvider.getKubeConfig(clusterId);
    return kubeConfig.makeApiClient(CoreV1Api);
  }

  /**
   * 시나리오 또는 커스텀 매니페스트를 클러스터에 배포하고 어드미션/감사 결과를 획득합니다.
   *
   * @param dto 배포 시뮬레이션 요청 DTO
   * @returns 시뮬레이션 실행 결과 (어드미션 차단 여부, 위반 정책명, 예외신청 연동 데이터)
   */
  async deploySimulation(
    dto: DeploySimulationDto,
  ): Promise<SimulationDeployResult> {
    const clusterId = dto.clusterId || "default";
    let yamlString = dto.customYaml;
    let scenario: SimulationScenario | undefined;

    if (dto.scenarioId) {
      scenario = this.SCENARIOS.find((s) => s.id === dto.scenarioId);
      if (!scenario) {
        throw new BusinessException(SIMULATION_ERROR.SCENARIO_NOT_FOUND);
      }
      yamlString = scenario.yaml;
    }

    if (!yamlString) {
      throw new BusinessException(SIMULATION_ERROR.INVALID_YAML, {
        message: "시나리오 ID 또는 매니페스트 YAML을 지정해야 합니다.",
      });
    }

    let manifest: any;
    try {
      manifest = yaml.load(yamlString);
    } catch (e) {
      throw new BusinessException(SIMULATION_ERROR.INVALID_YAML, {
        message: `YAML 파싱에 실패했습니다: ${(e as Error).message}`,
      });
    }

    if (!manifest || typeof manifest !== "object" || manifest.kind !== "Pod") {
      throw new BusinessException(SIMULATION_ERROR.INVALID_YAML, {
        message: "시뮬레이션은 현재 'Pod' 리소스 매니페스트만 지원합니다.",
      });
    }

    // 타겟 네임스페이스 결정
    const targetNamespace =
      dto.namespace ||
      manifest.metadata?.namespace ||
      scenario?.namespace ||
      "governance-testbed";
    manifest.metadata = manifest.metadata || {};
    manifest.metadata.namespace = targetNamespace;

    // 시뮬레이션 리소스 식별용 라벨 주입
    manifest.metadata.labels = manifest.metadata.labels || {};
    manifest.metadata.labels[this.TESTBED_LABEL_KEY] = this.TESTBED_LABEL_VALUE;
    if (scenario) {
      manifest.metadata.labels["simulation.kyverno.io/scenario-id"] =
        scenario.id;
    }

    const podName = manifest.metadata.name || `sim-pod-${Date.now()}`;
    manifest.metadata.name = podName;

    const coreV1 = this.getCoreV1Api(clusterId);

    // 기존 동일 이름의 파드가 이미 존재하면 먼저 정리 시도
    try {
      await coreV1.deleteNamespacedPod({
        name: podName,
        namespace: targetNamespace,
        gracePeriodSeconds: 0,
      });
      // 파드 삭제 후 잠시 대기
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch {
      // 파드가 없었던 경우 무시
    }

    try {
      // 파드 생성 시도 (Kyverno 어드미션 웹훅 트리거)
      await coreV1.createNamespacedPod({
        namespace: targetNamespace,
        body: manifest as V1Pod,
      });

      this.logger.log(
        `Simulation Pod deployed successfully: ${targetNamespace}/${podName}`,
      );

      const isAuditExpected = scenario?.expectedResult === "AUDIT_VIOLATION";

      return {
        scenarioId: scenario?.id,
        status: "ALLOWED",
        allowed: true,
        message: isAuditExpected
          ? "파드가 성공적으로 배포되었습니다. (Audit 모드 정책 위반 여부는 PolicyReport를 통해 비동기 수집됩니다)"
          : "모든 거버넌스 정책 검증을 통과하여 파드가 성공적으로 배포되었습니다.",
        policyName: scenario?.targetPolicy,
        resourceKind: "Pod",
        resourceName: podName,
        namespace: targetNamespace,
        timestamp: new Date().toISOString(),
        exceptionApplicable: isAuditExpected,
        suggestedException: isAuditExpected
          ? {
              policyName: scenario?.targetPolicy || "",
              resourceKind: "Pod",
              resourceName: podName,
              namespace: targetNamespace,
            }
          : undefined,
      };
    } catch (err: any) {
      // Kyverno 어드미션 웹훅 차단 (403/400)
      let rawMessage = "";

      if (typeof err?.body === "string") {
        try {
          const parsedBody = JSON.parse(err.body);
          rawMessage = parsedBody.message || err.body;
        } catch {
          rawMessage = err.body;
        }
      } else if (err?.response?.body?.message) {
        rawMessage = err.response.body.message;
      } else if (err?.message) {
        // "Body: \"{...}\"" 형태인 경우 추출 시도
        const bodyMatch = err.message.match(/Body:\s*"(\{.*?\})"/s);
        if (bodyMatch) {
          try {
            const unescaped = JSON.parse(`"${bodyMatch[1]}"`);
            const statusObj = JSON.parse(unescaped);
            rawMessage = statusObj.message || err.message;
          } catch {
            rawMessage = err.message;
          }
        } else {
          rawMessage = err.message;
        }
      }

      this.logger.warn(
        `Simulation Pod deployment blocked: ${targetNamespace}/${podName}, error: ${rawMessage}`,
      );

      // Kyverno 웹훅 에러 메시지 파싱
      const parsed = this.parseKyvernoBlockedError(rawMessage);

      return {
        scenarioId: scenario?.id,
        status: "BLOCKED",
        allowed: false,
        message:
          "Kyverno Admission Webhook에 의해 리소스 배포가 거부(Blocked)되었습니다.",
        blockedReason: parsed.reason || rawMessage,
        policyName: parsed.policyName || scenario?.targetPolicy,
        ruleName: parsed.ruleName,
        resourceKind: "Pod",
        resourceName: podName,
        namespace: targetNamespace,
        timestamp: new Date().toISOString(),
        exceptionApplicable: true,
        suggestedException: {
          policyName: parsed.policyName || scenario?.targetPolicy || "",
          ruleName: parsed.ruleName,
          resourceKind: "Pod",
          resourceName: podName,
          namespace: targetNamespace,
        },
      };
    }
  }

  /**
   * Kyverno 어드미션 웹훅의 거부 메시지에서 정책명, 규칙명 및 사유를 파싱합니다.
   */
  private parseKyvernoBlockedError(rawMessage: string): {
    policyName?: string;
    ruleName?: string;
    reason?: string;
  } {
    // 패턴 예:
    // resource Pod/governance-testbed/test was blocked due to the following policies
    // disallow-latest-tag:
    //   disallow-latest-tag: 'validation error: ... rule disallow-latest-tag failed at path ...'
    const policyBlockRegex =
      /blocked due to the following policies\s*\n\s*([a-zA-Z0-9_-]+):\s*\n\s*([a-zA-Z0-9_-]+):\s*'?(.*?)'?(?:\n[a-zA-Z0-9_-]+:|$)/s;
    const match = rawMessage.match(policyBlockRegex);

    if (match) {
      return {
        policyName: match[1],
        ruleName: match[2],
        reason: match[3]?.trim(),
      };
    }

    return {
      reason: rawMessage,
    };
  }

  /**
   * 현재 클러스터에 배포되어 있는 시뮬레이션 파드 목록을 조회합니다.
   */
  async getActiveSimulationResources(clusterId = "default") {
    const coreV1 = this.getCoreV1Api(clusterId);
    try {
      const response = await coreV1.listPodForAllNamespaces({
        labelSelector: `${this.TESTBED_LABEL_KEY}=${this.TESTBED_LABEL_VALUE}`,
      });

      return (response.items || []).map((pod) => ({
        name: pod.metadata?.name,
        namespace: pod.metadata?.namespace,
        status: pod.status?.phase || "Unknown",
        scenarioId:
          pod.metadata?.labels?.["simulation.kyverno.io/scenario-id"] ||
          "custom",
        createdAt: pod.metadata?.creationTimestamp,
      }));
    } catch (e) {
      this.logger.error("Failed to list simulation pods", e);
      return [];
    }
  }

  /**
   * 생성된 시뮬레이션 파드들을 일괄 정리(삭제)합니다.
   */
  async cleanupSimulationResources(clusterId = "default") {
    const coreV1 = this.getCoreV1Api(clusterId);
    const activePods = await this.getActiveSimulationResources(clusterId);
    const deleted: string[] = [];

    for (const pod of activePods) {
      if (!pod.name || !pod.namespace) continue;
      try {
        await coreV1.deleteNamespacedPod({
          name: pod.name,
          namespace: pod.namespace,
          gracePeriodSeconds: 0,
        });
        deleted.push(`${pod.namespace}/${pod.name}`);
      } catch (e) {
        this.logger.warn(`Failed to delete simulation pod ${pod.name}: ${e}`);
      }
    }

    return {
      message: `${deleted.length}개의 시뮬레이션 파드가 성공적으로 삭제되었습니다.`,
      deletedResources: deleted,
    };
  }
}
