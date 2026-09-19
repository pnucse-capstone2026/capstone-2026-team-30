import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import {
  CoreV1Api,
  KubernetesObject,
  KubernetesObjectApi,
  V1Pod,
} from "@kubernetes/client-node";
import * as yaml from "js-yaml";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { IncidentsService } from "../incidents/incidents.service";
import { BusinessException } from "../common/errors/business.exception";
import { SIMULATION_ERROR } from "./simulation.errors";
import {
  DeploySimulationDto,
  SimulationDeployResult,
  SimulationScenario,
} from "./dto/deploy-simulation.dto";
import {
  KyvernoViolationDetail,
  ManifestDryRunValidationResult,
  ParsedKyvernoError,
  ResourceDryRunResult,
} from "./dto/dry-run-validation.dto";
import { InMemoryFastFailEngine } from "./fast-fail/in-memory-fast-fail.engine";

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
        "컨테이너 이미지에 불변 태그 대신 ':latest'를 사용한 워크로드입니다. Kyverno 어드미션 컨트롤러(Enforce 모드) 및 Tier 1 Fast-Fail 사전 검증에 의해 파드 생성이 즉시 차단(Denied/Blocked)됩니다.",
      namespace: "governance-testbed",
      yaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-tag-violation-latest
  namespace: governance-testbed
  labels:
    app.kubernetes.io/name: simulation-test
    team: devops
spec:
  restartPolicy: Never
  containers:
    - name: test-container
      image: registry.k8s.io/pause:latest
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
        runAsNonRoot: true
        runAsUser: 10001
`,
    },
    {
      id: "disallow-privileged",
      title: "2. 특권(Privileged) 컨테이너 배포 (보안 감사 검증)",
      category: "Pod Security",
      severity: "CRITICAL",
      targetPolicy: "disallow-privileged-containers",
      expectedResult: "AUDIT_VIOLATION",
      description:
        "securityContext.privileged: true가 설정된 고위험 파드입니다. Audit 모드 정책에 의해 입구 단계 배포는 허용되지만, 비동기 PolicyReport에 위반으로 기록되어 보안 감사 관제 대상이 됩니다.",
      namespace: "governance-testbed",
      yaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-priv-violation-pod
  namespace: governance-testbed
  labels:
    app.kubernetes.io/name: simulation-test
    team: devops
spec:
  restartPolicy: Never
  containers:
    - name: test-container
      image: registry.k8s.io/pause:3.10
      securityContext:
        privileged: true
        runAsNonRoot: true
        runAsUser: 10001
      resources:
        requests:
          cpu: 10m
          memory: 16Mi
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
        "resources(requests/limits) 설정이 누락되어 노드 자원 고갈 위험이 있는 파드입니다. Audit 모드로 배포는 허용되나 위반 보고서에 수집되어 FinOps 및 안정성 거버넌스 개선 대상으로 분류됩니다.",
      namespace: "governance-testbed",
      yaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-missing-limits-pod
  namespace: governance-testbed
  labels:
    app.kubernetes.io/name: simulation-test
    team: devops
spec:
  restartPolicy: Never
  containers:
    - name: test-container
      image: registry.k8s.io/pause:3.10
      securityContext:
        privileged: false
        allowPrivilegeEscalation: false
        runAsNonRoot: true
        runAsUser: 10001
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
        "표준 식별 레이블, 고정 버전 태그, 비특권/Non-Root 보안 컨텍스트, 컴퓨팅 자원 한도를 모두 충족하는 모범 규격 파드입니다. 어드미션 통과 및 감사 위반 없이 정상 실행됩니다.",
      namespace: "governance-testbed",
      yaml: `apiVersion: v1
kind: Pod
metadata:
  name: test-compliant-pod
  namespace: governance-testbed
  labels:
    app.kubernetes.io/name: simulation-test
    team: devops
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
        runAsNonRoot: true
        runAsUser: 10001
`,
    },
  ];

  constructor(
    @Inject(forwardRef(() => ClusterProvider))
    private readonly clusterProvider: ClusterProvider,
    private readonly fastFailEngine: InMemoryFastFailEngine,
    @Optional()
    @Inject(forwardRef(() => IncidentsService))
    private readonly incidentsService?: IncidentsService,
  ) {}

  /**
   * 사전 정의된 시뮬레이션 시나리오 목록을 반환합니다.
   */
  getScenarios(): SimulationScenario[] {
    return this.SCENARIOS;
  }

  /**
   * 시뮬레이션 워크로드가 배포될 유효한 대상 클러스터 식별자를 결정합니다.
   *
   * [멀티클러스터 거버넌스 라우팅 원칙]
   * 중앙 Hub 클러스터('kyverno-eks-lab')는 관리 제어면 전용으로 일반 워크로드 배포가 차단됩니다.
   * 따라서 clusterId가 지정되지 않았거나 'default'인 경우, 실제 워크로드가 실행되는
   * Production Spoke 클러스터('external-argocd-cluster' 등)를 우선 탐색하여 자동 라우팅합니다.
   *
   * @param requestedClusterId 사용자가 요청한 클러스터 식별자
   * @returns 실제 배포/검증 대상 클러스터 식별자
   */
  resolveTargetClusterId(requestedClusterId?: string): string {
    const allClusters =
      typeof this.clusterProvider?.list === "function"
        ? this.clusterProvider.list()
        : [];

    if (!allClusters || allClusters.length === 0) {
      return requestedClusterId || "default";
    }

    // 명시적으로 특정 클러스터가 전달되었고, 'default'가 아닌 경우
    if (requestedClusterId && requestedClusterId !== "default") {
      const matched = allClusters.find(
        (c) =>
          c.id === requestedClusterId || c.displayName === requestedClusterId,
      );
      if (matched) return matched.id;
    }

    // clusterId가 누락되었거나 'default'인 경우: 워크로드 실행용 Spoke 클러스터 우선 탐색
    const spokeCluster = allClusters.find(
      (c) =>
        c.id !== "kyverno-eks-lab" &&
        !c.displayName?.toLowerCase().includes("management only") &&
        !c.displayName?.toLowerCase().includes("central"),
    );

    if (spokeCluster) {
      this.logger.debug(
        `[SimulationService] Auto-routing simulation workload to Spoke cluster '${spokeCluster.id}' (${spokeCluster.displayName})`,
      );
      return spokeCluster.id;
    }

    return requestedClusterId || allClusters[0].id;
  }

  /**
   * Kubernetes CoreV1Api 클라이언트를 생성합니다.
   */
  private getCoreV1Api(clusterId = "default"): CoreV1Api {
    const targetClusterId = this.resolveTargetClusterId(clusterId);
    const kubeConfig = this.clusterProvider.getKubeConfig(targetClusterId);
    return kubeConfig.makeApiClient(CoreV1Api);
  }

  /**
   * KubernetesObjectApi 클라이언트를 생성합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   */
  private getKubernetesObjectApi(clusterId = "default"): KubernetesObjectApi {
    const targetClusterId = this.resolveTargetClusterId(clusterId);
    const kubeConfig = this.clusterProvider.getKubeConfig(targetClusterId);
    return kubeConfig.makeApiClient(KubernetesObjectApi);
  }

  /**
   * 시뮬레이션 파드가 배포될 대상 네임스페이스의 존재 여부를 확인하고, 없을 경우 안전하게 자동 생성합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param namespace 확인할 네임스페이스명
   */
  async ensureNamespaceExists(
    clusterId = "default",
    namespace = "default",
  ): Promise<void> {
    if (!namespace || namespace === "default" || namespace === "kube-system") {
      return;
    }

    const coreV1 = this.getCoreV1Api(clusterId);
    try {
      await coreV1.readNamespace({ name: namespace });
    } catch (err: any) {
      const statusCode =
        err?.response?.statusCode || err?.statusCode || err?.status;
      const rawMessage = err?.message || err?.body || "";
      const isNotFound =
        statusCode === 404 || /not found/i.test(String(rawMessage));

      if (isNotFound) {
        this.logger.log(
          `Namespace '${namespace}' not found in cluster '${clusterId}'. Creating it automatically for simulation...`,
        );
        try {
          await coreV1.createNamespace({
            body: {
              apiVersion: "v1",
              kind: "Namespace",
              metadata: {
                name: namespace,
                labels: {
                  "app.kubernetes.io/managed-by": "kyverno-simulation",
                  [this.TESTBED_LABEL_KEY]: this.TESTBED_LABEL_VALUE,
                },
              },
            },
          });
          this.logger.log(
            `Namespace '${namespace}' successfully created for simulation.`,
          );
        } catch (createErr: any) {
          const createStatus =
            createErr?.response?.statusCode ||
            createErr?.statusCode ||
            createErr?.status;
          // 동시 생성 경쟁으로 인한 409 Conflict는 정상 처리
          if (
            createStatus !== 409 &&
            !/already exists/i.test(String(createErr?.message))
          ) {
            this.logger.warn(
              `Failed to automatically create namespace '${namespace}': ${(createErr as Error).message}`,
            );
          }
        }
      }
    }
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
      // 사용자가 에디터에서 수정한 customYaml이 전달된 경우 이를 최우선 사용하고, 없을 때만 시나리오 기본 YAML 적용
      yamlString = dto.customYaml || scenario.yaml;
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

    // 타겟 네임스페이스 결정 (사용자가 작성한 매니페스트 네임스페이스 최우선 반영)
    const targetNamespace =
      manifest.metadata?.namespace ||
      dto.namespace ||
      scenario?.namespace ||
      "default";
    manifest.metadata = manifest.metadata || {};
    manifest.metadata.namespace = targetNamespace;

    // 대상 네임스페이스 자동 보장 (Self-Healing Namespace)
    await this.ensureNamespaceExists(clusterId, targetNamespace);

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
        `Simulation Pod deployment error: ${targetNamespace}/${podName}, error: ${rawMessage}`,
      );

      // Kyverno 웹훅 에러 메시지 파싱
      const parsed = this.parseKyvernoBlockedError(rawMessage);

      // Hub 클러스터 워크로드 격리 거버넌스 차단 특화 감지
      const isHubIsolation =
        rawMessage.includes("isolate-management-hub-cluster") ||
        rawMessage.includes("중앙 관리 제어면 전용");
      if (isHubIsolation) {
        return {
          scenarioId: scenario?.id,
          status: "BLOCKED",
          allowed: false,
          message:
            "❌ [거버넌스 차단] Hub 클러스터(kyverno-eks-lab)는 중앙 관리 제어면 전용입니다. 정책 시뮬레이션 및 일반 워크로드는 Production Spoke 클러스터(kyverno-eks-spoke-01)를 선택하여 배포해야 합니다.",
          blockedReason:
            "Hub 클러스터 제로-트러스트 격리 정책(isolate-management-hub-cluster)에 의해 kyverno-platform 외 네임스페이스의 워크로드 생성이 차단되었습니다.",
          policyName: "isolate-management-hub-cluster",
          ruleName: "block-non-platform-workloads",
          resourceKind: "Pod",
          resourceName: podName,
          namespace: targetNamespace,
          timestamp: new Date().toISOString(),
          exceptionApplicable: false,
          suggestedException: undefined,
        };
      }

      // K8s API 인프라 오류 vs 실제 Kyverno 웹훅 차단 분리 판별
      const isNamespaceNotFound = /namespaces\s*".*"\s*not found/i.test(
        rawMessage,
      );
      const isKyvernoWebhookBlock =
        /admission webhook.*denied the request|validation error|blocked due to the following policies/i.test(
          rawMessage,
        ) ||
        (parsed.violations.length > 0 && !isNamespaceNotFound);

      if (!isKyvernoWebhookBlock) {
        // 네임스페이스 부재, 권한 부족(RBAC), 파싱 오류 등 인프라 시스템 오류인 경우
        const userFriendlyMessage = isNamespaceNotFound
          ? `배포 대상 네임스페이스('${targetNamespace}')가 클러스터에 존재하지 않거나 접근할 수 없습니다.`
          : `Kubernetes API 서버 오류가 발생했습니다: ${rawMessage}`;

        return {
          scenarioId: scenario?.id,
          status: "ERROR",
          allowed: false,
          message: userFriendlyMessage,
          blockedReason: rawMessage,
          policyName: undefined,
          ruleName: undefined,
          resourceKind: "Pod",
          resourceName: podName,
          namespace: targetNamespace,
          timestamp: new Date().toISOString(),
          exceptionApplicable: false,
          suggestedException: undefined,
        };
      }

      const blockedPolicy =
        parsed.policyName || scenario?.targetPolicy || "kyverno-policy";

      // Closed-Loop 인시던트 관제 연동: 배포 차단 발생 시 DB 영속화 및 대시보드 경보 브로드캐스트
      if (
        this.incidentsService &&
        blockedPolicy !== "isolate-management-hub-cluster"
      ) {
        this.incidentsService
          .recordAdmissionBlock({
            clusterId,
            namespace: targetNamespace,
            resourceKind: "Pod",
            resourceName: podName,
            policyName: blockedPolicy,
            ruleName: parsed.ruleName,
            blockReason: parsed.reason || rawMessage,
            metadata: {
              source: "PolicySimulation",
              scenarioId: scenario?.id,
              blockedAt: new Date().toISOString(),
            },
          })
          .catch((incErr) => {
            this.logger.debug(
              `Failed to record simulation admission block incident: ${(incErr as Error).message}`,
            );
          });
      }

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
   * Kyverno 어드미션 웹훅의 거부 메시지에서 정책명, 규칙명, 차단 사유 및 위반 목록을 파싱합니다.
   * 단일 및 다중 정책/규칙 위반 구문을 모두 지원합니다.
   *
   * @param rawMessage K8s API 서버 또는 Kyverno 웹훅으로부터 반환된 원본 에러 문자열
   * @returns 파싱된 정책명, 규칙명, 사유 및 상세 위반 배열
   */
  parseKyvernoBlockedError(rawMessage: string): ParsedKyvernoError {
    const violations: KyvernoViolationDetail[] = [];

    // 1. "blocked due to the following policies" 블록 패턴 파싱
    const blockSplit = rawMessage.split(
      /blocked due to the following policies\s*\n?/i,
    );
    if (blockSplit.length > 1) {
      const policiesBlock = blockSplit[1];
      const lines = policiesBlock.split("\n");
      let currentPolicy = "";

      for (const line of lines) {
        // 정책명 감지 (예: disallow-latest-tag:)
        const policyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*$/);
        if (policyMatch) {
          currentPolicy = policyMatch[1].trim();
          continue;
        }

        // 규칙명 및 메시지 감지 (예:   disallow-latest-tag: 'validation error: ...')
        const ruleMatch = line.match(/^\s+([a-zA-Z0-9_-]+):\s*'?(.+?)'?\s*$/);
        if (ruleMatch && currentPolicy) {
          const ruleName = ruleMatch[1].trim();
          const reasonText = ruleMatch[2].trim().replace(/^['"]|['"]$/g, "");

          // path 추출 (예: rule xxx failed at path /spec/containers/0/image/)
          const pathMatch = reasonText.match(/failed at path\s+([^\s]+)/i);
          const path = pathMatch ? pathMatch[1] : undefined;

          violations.push({
            policyName: currentPolicy,
            ruleName,
            reason: reasonText,
            path,
          });
        }
      }
    }

    // 2. 단일 인라인 패턴 (admission webhook "..." denied the request: validation error: ... rule xxx failed...)
    if (violations.length === 0) {
      const inlineMatch = rawMessage.match(
        /(?:denied the request:\s*)?(?:validation error:\s*)?(.+?)(?:\s*rule\s+([a-zA-Z0-9_-]+)\s+failed(?:\s+at path\s+([^\s]+))?)?$/is,
      );
      if (inlineMatch) {
        const policyNamedMatch = rawMessage.match(/policy\s+([a-zA-Z0-9_-]+)/i);
        const policy = policyNamedMatch ? policyNamedMatch[1] : undefined;
        const rule = inlineMatch[2];
        const path = inlineMatch[3];
        const reason = inlineMatch[1]?.trim() || rawMessage;

        violations.push({
          policyName: policy || "kyverno-policy",
          ruleName: rule,
          reason,
          path,
        });
      }
    }

    const first = violations[0];
    return {
      policyName: first?.policyName,
      ruleName: first?.ruleName,
      reason: first?.reason || rawMessage,
      violations,
    };
  }

  /**
   * 임의의 쿠버네티스 매니페스트 YAML 문자열을 Server-Side Dry-Run 방식으로 검증합니다.
   * etcd에 실제 리소스를 영속화하지 않고(`dryRun: ['All']`) Kyverno Admission Webhook의
   * 실제 동작을 100% 결정론적으로 검증합니다.
   * 다중 문서 매니페스트(YAML '---' 구분)를 지원하여 모든 리소스를 순차 검증합니다.
   *
   * @param manifestYaml 단일 또는 다중 쿠버네티스 리소스 매니페스트 YAML 원문
   * @param targetNamespace 기본 배포 대상 네임스페이스
   * @param clusterId 검증 대상 클러스터 식별자 (기본값: 'default')
   * @returns 각 리소스별 검증 결과 및 전체 집계 리포트
   * @throws {BusinessException} YAML 구문 파싱 실패(SIMULATION_ERROR.INVALID_YAML) 시
   */
  async validateManifestDryRun(
    manifestYaml: string,
    targetNamespace: string,
    clusterId = "default",
  ): Promise<ManifestDryRunValidationResult> {
    if (!manifestYaml || !manifestYaml.trim()) {
      throw new BusinessException(SIMULATION_ERROR.INVALID_YAML, {
        message: "검증할 매니페스트 YAML 내용이 비어 있습니다.",
      });
    }

    let parsedDocuments: unknown[] = [];
    try {
      parsedDocuments = yaml.loadAll(manifestYaml);
    } catch (e) {
      throw new BusinessException(SIMULATION_ERROR.INVALID_YAML, {
        message: `매니페스트 YAML 파싱에 실패했습니다: ${(e as Error).message}`,
      });
    }

    // null이나 원시값이 아닌 유효한 KubernetesObject 필터링
    const k8sObjects = parsedDocuments.filter(
      (doc): doc is KubernetesObject =>
        doc !== null &&
        typeof doc === "object" &&
        "apiVersion" in (doc as Record<string, unknown>) &&
        "kind" in (doc as Record<string, unknown>),
    );

    if (k8sObjects.length === 0) {
      throw new BusinessException(SIMULATION_ERROR.INVALID_YAML, {
        message:
          "유효한 Kubernetes 리소스(apiVersion과 kind를 포함하는 객체)를 찾을 수 없습니다.",
      });
    }

    const objectApi = this.getKubernetesObjectApi(clusterId);
    const results: ResourceDryRunResult[] = [];
    const allViolations: KyvernoViolationDetail[] = [];

    for (const obj of k8sObjects) {
      const apiVersion = obj.apiVersion || "v1";
      const kind = obj.kind || "Unknown";
      const name = obj.metadata?.name || "unnamed";

      // 클러스터 스코프 리소스가 아닐 경우 기본 targetNamespace 설정
      obj.metadata = obj.metadata || {};
      const namespace = obj.metadata.namespace || targetNamespace || "default";
      obj.metadata.namespace = namespace;

      // ADR 0008 Tier 1: 인메모리 Fast-Fail 선행 검증 (Zero Network I/O)
      const tier1Violations = this.fastFailEngine.evaluateResource(obj);
      if (tier1Violations.length > 0) {
        this.logger.log(
          `[Tier 1 Fast-Fail] Resource ${kind}/${name} blocked before webhook: ${tier1Violations.length} violations detected`,
        );
        results.push({
          apiVersion,
          kind,
          name,
          namespace,
          allowed: false,
          status: "BLOCKED",
          message:
            "Kyverno 어드미션 Tier 1 사전 검증에 의해 리소스 배포가 차단되었습니다.",
          blockedReason: tier1Violations[0]?.reason,
          violations: tier1Violations,
          rawError: `Tier 1 Fast-Fail blocked: ${tier1Violations.map((v) => v.reason).join("; ")}`,
        });
        allViolations.push(...tier1Violations);
        continue;
      }

      // Tier 2: K8s API Server 및 Kyverno Admission Webhook Dry-Run
      try {
        // dryRun: 'All'을 지정하여 etcd에 영속화하지 않고 어드미션 웹훅만 검증
        await objectApi.create(obj, undefined, "All");

        results.push({
          apiVersion,
          kind,
          name,
          namespace,
          allowed: true,
          status: "PASSED",
          message:
            "Kyverno 어드미션 및 쿠버네티스 스키마 검증을 정상 통과했습니다.",
          violations: [],
        });
      } catch (err: unknown) {
        let rawMessage = "";
        let statusCode: number | undefined;

        if (err instanceof Error) {
          if ("body" in err && (err as { body: unknown }).body) {
            const body = (err as { body: unknown }).body;
            rawMessage =
              typeof body === "string"
                ? body
                : (body as { message?: string }).message ||
                  JSON.stringify(body);
          } else {
            rawMessage = err.message;
          }
          if (
            "statusCode" in err &&
            typeof (err as { statusCode: unknown }).statusCode === "number"
          ) {
            statusCode = (err as { statusCode: number }).statusCode;
          } else if (
            "code" in err &&
            typeof (err as { code: unknown }).code === "number"
          ) {
            statusCode = (err as { code: number }).code;
          }
        } else {
          rawMessage = String(err);
        }

        const isHubIsolation =
          rawMessage.includes("isolate-management-hub-cluster") ||
          rawMessage.includes("중앙 관리 제어면 전용");

        if (isHubIsolation) {
          const violation: KyvernoViolationDetail = {
            policyName: "isolate-management-hub-cluster",
            ruleName: "block-non-platform-workloads",
            reason:
              "❌ [거버넌스 차단] Hub 클러스터(kyverno-eks-lab)는 중앙 관리 제어면 전용입니다. 일반 비즈니스 워크로드는 Production Spoke 클러스터(kyverno-eks-spoke-01)에 배포해야 합니다.",
          };
          results.push({
            apiVersion,
            kind,
            name,
            namespace,
            allowed: false,
            status: "BLOCKED",
            message:
              "Hub 클러스터 제어면 격리 정책(isolate-management-hub-cluster)에 의해 차단되었습니다.",
            blockedReason: violation.reason,
            violations: [violation],
            rawError: rawMessage,
          });
          allViolations.push(violation);
          continue;
        }

        const isBlockedByWebhook =
          statusCode === 403 ||
          rawMessage.includes("blocked due to the following policies") ||
          rawMessage.includes("denied the request") ||
          rawMessage.includes("webhook");

        if (isBlockedByWebhook) {
          const parsed = this.parseKyvernoBlockedError(rawMessage);
          results.push({
            apiVersion,
            kind,
            name,
            namespace,
            allowed: false,
            status: "BLOCKED",
            message:
              "Kyverno 어드미션 웹훅에 의해 리소스 배포가 거부(Blocked)되었습니다.",
            blockedReason: parsed.reason,
            violations: parsed.violations,
            rawError: rawMessage,
          });
          allViolations.push(...parsed.violations);
        } else {
          results.push({
            apiVersion,
            kind,
            name,
            namespace,
            allowed: false,
            status: "ERROR",
            message: `리소스 사전 검증 중 API 서버 오류가 발생했습니다: ${rawMessage}`,
            violations: [],
            rawError: rawMessage,
          });
        }
      }
    }

    const blockedCount = results.filter((r) => r.status === "BLOCKED").length;
    const errorCount = results.filter((r) => r.status === "ERROR").length;
    const passedCount = results.filter((r) => r.status === "PASSED").length;

    return {
      valid: blockedCount === 0 && errorCount === 0,
      allowed: blockedCount === 0,
      totalResources: results.length,
      blockedCount,
      passedCount,
      errorCount,
      results,
      allViolations,
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
