import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ExceptionStatus, PolicyExceptionRequest } from "@prisma/client";
import { KubernetesObject } from "@kubernetes/client-node";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { PrismaService } from "../../prisma/prisma.service";
import { IncidentsService } from "../../incidents/incidents.service";
import {
  InformerResourceType,
  K8sInformerService,
} from "../k8s-informer.service";
import { KyvernoAdapter } from "../kyverno.adapter";
import {
  buildPolicyExceptionManifest,
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
} from "../policy-exception-manifest";

/**
 * 임의의 객체를 키 순서대로 재귀 정렬하여 일관된 직렬화를 보장하는 헬퍼 함수
 *
 * @param value 정규화할 값 또는 객체
 * @returns 정렬 정규화된 객체
 */
export function normalizeObject(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeObject);
  }
  if (typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = normalizeObject((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

/**
 * 리소스의 spec 필드를 정렬된 JSON 문자열로 직렬화한 후 SHA-256 해시를 계산합니다.
 *
 * @param spec K8s 리소스의 spec 객체
 * @returns SHA-256 16진수 해시 문자열
 */
export function computeSpecHash(spec: unknown): string {
  if (spec === undefined || spec === null) {
    return createHash("sha256").update("").digest("hex");
  }
  const normalized = normalizeObject(spec);
  const jsonStr = JSON.stringify(normalized);
  return createHash("sha256").update(jsonStr).digest("hex");
}

/**
 * Spoke 클러스터의 정책 변경 감지 결과 인터페이스
 */
export interface DriftDetectionResult {
  drifted: boolean;
  clusterId: string;
  resourceName: string;
  eventType: "update" | "delete";
  expectedHash?: string;
  actualHash?: string | null;
  autoHealed?: boolean;
}

/**
 * Spoke 클러스터 정책 드리프트(Drift) 감지 및 양방향 Self-Healing 엔진
 *
 * K8s Informer 이벤트 스트림을 구독하여 Spoke 현장에서 kubectl로 직접 수행된
 * 미승인 변조(Out-of-band mutation) 및 임의 삭제(Out-of-band deletion)를 실시간 감지하고,
 * 거버넌스 인시던트 등록 및 Hub DB 원본 매니페스트로 자동 복구(Auto-Heal)합니다.
 */
@Injectable()
export class PolicyDriftDetectorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PolicyDriftDetectorService.name);
  private unsubscribe?: () => void;
  private autoHealEnabled = true;

  // 자가 치유(Self-Healing) 후 발생하는 재귀적 Informer 이벤트 폭풍(Loop Storm)을 방어하기 위한 쿨다운 캐시
  // Key: `${clusterId}:${name}`, Value: 복구 시도 타임스탬프 (밀리초)
  private readonly healingCooldownCache = new Map<string, number>();
  private readonly HEALING_COOLDOWN_MS = 15_000;

  constructor(
    private readonly informerService: K8sInformerService,
    private readonly prisma: PrismaService,
    private readonly incidentsService: IncidentsService,
    private readonly kyvernoAdapter: KyvernoAdapter,
    @Optional() private readonly configService?: ConfigService,
  ) {
    if (this.configService) {
      const autoHealVal = this.configService
        .get<string>("DRIFT_AUTO_HEAL_ENABLED", "true")
        ?.trim()
        .toLowerCase();
      this.autoHealEnabled = autoHealVal !== "false" && autoHealVal !== "0";
    }
  }

  /**
   * 모듈 초기화 시 Informer의 리소스 변경 리스너를 등록합니다.
   */
  async onModuleInit(): Promise<void> {
    this.unsubscribe = this.informerService.registerChangeListener(
      (clusterId, resourceType, eventType, obj) => {
        void this.handleResourceMutation(
          clusterId,
          resourceType,
          eventType,
          obj,
        );
      },
    );
    this.logger.log(
      `[DriftDetector] Policy drift detection engine initialized (auto-heal: ${this.autoHealEnabled}).`,
    );
  }

  /**
   * 모듈 파괴 시 구독을 해제하고 쿨다운 캐시를 비웁니다.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    this.healingCooldownCache.clear();
    this.logger.log("[DriftDetector] Policy drift detection engine stopped.");
  }

  /**
   * Spoke 클러스터에서 수신된 K8s 리소스 변조 이벤트를 분석하고 드리프트를 처리합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param resourceType Informer 감시 리소스 타입
   * @param eventType 이벤트 종류 (add, update, delete)
   * @param obj 수신된 K8s 리소스 객체
   * @returns 드리프트 감지 및 자가 치유 결과
   */
  async handleResourceMutation(
    clusterId: string,
    resourceType: InformerResourceType,
    eventType: "add" | "update" | "delete",
    obj: KubernetesObject,
  ): Promise<DriftDetectionResult | null> {
    if (resourceType === "clusterpolicies") {
      return this.handleClusterPolicyDrift(clusterId, eventType, obj);
    }
    if (resourceType === "policyexceptions") {
      return this.handlePolicyExceptionDrift(clusterId, eventType, obj);
    }
    return null;
  }

  /**
   * Spoke 클러스터에서 수신된 PolicyException 리소스의 변조/삭제 이벤트를 처리합니다.
   */
  async handlePolicyExceptionDrift(
    clusterId: string,
    eventType: "add" | "update" | "delete",
    obj: KubernetesObject,
  ): Promise<DriftDetectionResult | null> {
    if (eventType !== "update" && eventType !== "delete") {
      return null;
    }

    const name = obj.metadata?.name;
    if (!name) {
      return null;
    }

    // 2. Hub DB에서 해당 클러스터의 정책 예외 레코드 조회
    let request: PolicyExceptionRequest | null = null;
    try {
      request = await this.prisma.policyExceptionRequest.findFirst({
        where: {
          targetClusterId: clusterId,
          k8sExceptionName: name,
        },
      });
    } catch (dbErr) {
      this.logger.error(
        `[DriftDetector] Failed to query Hub DB for ${clusterId}/${name}: ${
          dbErr instanceof Error ? dbErr.message : String(dbErr)
        }`,
      );
      return null;
    }

    // Hub DB에 등록되지 않은 리소스인 경우 관리 대상 여부 확인
    if (!request) {
      const labels = obj.metadata?.labels || {};
      const isManaged = labels[MANAGED_BY_LABEL] === MANAGED_BY_VALUE;
      if (isManaged) {
        this.logger.warn(
          `[DriftDetector] Orphan managed PolicyException '${name}' detected on cluster '${clusterId}' without DB record.`,
        );
      }
      return null;
    }

    // 3. 승인/적용 상태인 정책만 활성 상태로 간주하여 드리프트 대조
    const isActive =
      request.status === ExceptionStatus.APPROVED ||
      request.status === ExceptionStatus.APPLYING;

    if (!isActive) {
      // 이미 취소/만료/실패된 요청의 삭제 이벤트는 정상 정리 과정이므로 무시
      return null;
    }

    // 4. 승인 당시의 Hub DB 원본 매니페스트를 기준으로 기대 spec 및 해시 계산
    const appliedRules =
      request.appliedRuleNames && request.appliedRuleNames.length > 0
        ? request.appliedRuleNames
        : request.ruleNames;

    const expectedManifest = buildPolicyExceptionManifest({
      name: request.k8sExceptionName,
      namespace:
        obj.metadata?.namespace || request.resourceNamespace || "kyverno",
      requestId: request.id,
      policyName: request.policyName,
      ruleNames: appliedRules,
      resourceKind: request.resourceKind,
      resourceName: request.resourceName,
      resourceNamespace: request.resourceNamespace,
    });

    const expectedHash = computeSpecHash(expectedManifest.spec);

    let isDrift = false;
    let actualHash: string | null = null;

    if (eventType === "delete") {
      // 활성 상태 정책이 Spoke 클러스터에서 미승인 임의 삭제됨
      isDrift = true;
      actualHash = null;
    } else if (eventType === "update") {
      // 수신된 리소스의 실제 spec 해시 계산
      const currentSpec = (obj as { spec?: unknown }).spec;
      actualHash = computeSpecHash(currentSpec);
      if (actualHash !== expectedHash) {
        isDrift = true;
      }
    }

    const cooldownKey = `${clusterId}:${name}`;
    const lastHealedAt = this.healingCooldownCache.get(cooldownKey);
    const now = Date.now();

    if (!isDrift) {
      // 정상 상태 이벤트 수신 시 복구 쿨다운 해제
      if (lastHealedAt) {
        this.healingCooldownCache.delete(cooldownKey);
      }
      return {
        drifted: false,
        clusterId,
        resourceName: name,
        eventType,
        expectedHash,
        actualHash,
      };
    }

    // 쿨다운 기간 내 재귀적 이벤트 억제 (Informer Reconcile Storm 원천 차단)
    if (lastHealedAt && now - lastHealedAt < this.HEALING_COOLDOWN_MS) {
      this.logger.warn(
        `[DriftDetector] Suppression: Self-healing cooldown active for ${clusterId}/${name} (${
          now - lastHealedAt
        }ms < ${this.HEALING_COOLDOWN_MS}ms). Skipping cascade auto-heal.`,
      );
      return {
        drifted: true,
        clusterId,
        resourceName: name,
        eventType,
        expectedHash,
        actualHash,
        autoHealed: false,
      };
    }

    // 5. 드리프트 발생: 경고 로그 출력
    this.logger.warn(
      `[DriftDetector] Out-of-band mutation detected on ${clusterId}/${name} (event: ${eventType}, expected: ${expectedHash.slice(
        0,
        8,
      )}, actual: ${actualHash ? actualHash.slice(0, 8) : "DELETED"})`,
    );

    // 6. 거버넌스 인시던트 등록 (UNAUTHORIZED_POLICY_MUTATION)
    const blockReason =
      eventType === "delete"
        ? `PolicyException '${name}' was deleted out-of-band on cluster '${clusterId}'. Expected active governance exception.`
        : `PolicyException '${name}' was mutated out-of-band on cluster '${clusterId}'. Spec SHA-256 hash mismatch (expected: ${expectedHash.slice(
            0,
            8,
          )}, actual: ${actualHash ? actualHash.slice(0, 8) : "UNKNOWN"}).`;

    try {
      await this.incidentsService.recordAdmissionBlock({
        clusterId,
        namespace:
          obj.metadata?.namespace || request.resourceNamespace || "kyverno",
        resourceKind: "PolicyException",
        resourceName: name,
        policyName: request.policyName,
        ruleName: "UNAUTHORIZED_POLICY_MUTATION",
        blockReason,
        metadata: {
          eventType,
          incidentType: "UNAUTHORIZED_POLICY_MUTATION",
          expectedHash,
          actualHash,
          requestId: request.id,
          k8sExceptionName: request.k8sExceptionName,
          driftDetectedAt: new Date().toISOString(),
        },
      });
    } catch (incidentErr) {
      this.logger.error(
        `[DriftDetector] Failed to record UNAUTHORIZED_POLICY_MUTATION incident for ${clusterId}/${name}: ${
          incidentErr instanceof Error
            ? incidentErr.message
            : String(incidentErr)
        }`,
      );
    }

    // 7. Auto-Heal 모드 활성화 시 Hub 원본 매니페스트로 즉시 복구
    let autoHealed = false;
    if (this.autoHealEnabled) {
      this.healingCooldownCache.set(cooldownKey, now);
      try {
        this.logger.log(
          `[DriftDetector] Auto-healing drift for PolicyException '${name}' on cluster '${clusterId}'...`,
        );
        await this.kyvernoAdapter.restorePolicyException(clusterId, {
          name: request.k8sExceptionName,
          requestId: request.id,
          policyName: request.policyName,
          ruleNames: appliedRules,
          resourceKind: request.resourceKind,
          resourceName: request.resourceName,
          resourceNamespace: request.resourceNamespace,
        });
        autoHealed = true;
        this.logger.log(
          `[DriftDetector] Successfully auto-healed PolicyException '${name}' on cluster '${clusterId}'.`,
        );
      } catch (healErr) {
        this.logger.error(
          `[DriftDetector] Failed to auto-heal PolicyException '${name}' on cluster '${clusterId}': ${
            healErr instanceof Error ? healErr.message : String(healErr)
          }`,
        );
      }
    }

    return {
      drifted: true,
      clusterId,
      resourceName: name,
      eventType,
      expectedHash,
      actualHash,
      autoHealed,
    };
  }

  /**
   * Spoke 또는 Hub 클러스터에서 발생한 ClusterPolicy 리소스 변경/삭제 이벤트를 감지하고 GitOps baseline과 대조합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param eventType 이벤트 종류 (add | update | delete)
   * @param obj Kubernetes 리소스 객체
   */
  async handleClusterPolicyDrift(
    clusterId: string,
    eventType: "add" | "update" | "delete",
    obj: KubernetesObject,
  ): Promise<DriftDetectionResult | null> {
    if (eventType !== "update" && eventType !== "delete") {
      return null;
    }

    const name = obj.metadata?.name;
    if (!name) return null;

    // GitOps baseline 매니페스트 조회 (k8s-manifests/policies/<name>.yaml 또는 policies-hub-only)
    const baselineManifest = this.loadGitOpsPolicyManifest(name);
    if (!baselineManifest) {
      // GitOps 관리 대상이 아닌 임의의 런타임 정책인 경우 드리프트 감지 생략
      return null;
    }

    const expectedSpec = baselineManifest.spec;
    const expectedHash = computeSpecHash(expectedSpec);

    let isDrift = false;
    let actualHash: string | null = null;

    if (eventType === "delete") {
      isDrift = true;
      actualHash = null;
    } else if (eventType === "update") {
      const currentSpec = (obj as { spec?: unknown }).spec;
      actualHash = computeSpecHash(currentSpec);
      if (actualHash !== expectedHash) {
        isDrift = true;
      }
    }

    const cooldownKey = `clusterpolicy:${clusterId}:${name}`;
    const lastHealedAt = this.healingCooldownCache.get(cooldownKey);
    const now = Date.now();

    if (!isDrift) {
      if (lastHealedAt) {
        this.healingCooldownCache.delete(cooldownKey);
      }
      return {
        drifted: false,
        clusterId,
        resourceName: name,
        eventType,
        expectedHash,
        actualHash,
      };
    }

    // 쿨다운 검사
    if (lastHealedAt && now - lastHealedAt < this.HEALING_COOLDOWN_MS) {
      this.logger.warn(
        `[DriftDetector] Suppression: Self-healing cooldown active for ClusterPolicy ${clusterId}/${name}. Skipping cascade auto-heal.`,
      );
      return {
        drifted: true,
        clusterId,
        resourceName: name,
        eventType,
        expectedHash,
        actualHash,
        autoHealed: false,
      };
    }

    // 경고 로그
    this.logger.warn(
      `[DriftDetector] Out-of-band mutation detected on ClusterPolicy ${clusterId}/${name} (event: ${eventType}, expected: ${expectedHash.slice(
        0,
        8,
      )}, actual: ${actualHash ? actualHash.slice(0, 8) : "DELETED"})`,
    );

    // 거버넌스 인시던트 등록 (UNAUTHORIZED_POLICY_MUTATION)
    const blockReason =
      eventType === "delete"
        ? `ClusterPolicy '${name}' was deleted out-of-band on cluster '${clusterId}'. Expected active governance policy.`
        : `ClusterPolicy '${name}' was mutated out-of-band on cluster '${clusterId}'. Spec SHA-256 hash mismatch (expected: ${expectedHash.slice(
            0,
            8,
          )}, actual: ${actualHash ? actualHash.slice(0, 8) : "UNKNOWN"}).`;

    try {
      await this.incidentsService.recordAdmissionBlock({
        clusterId,
        namespace: "default",
        resourceKind: "ClusterPolicy",
        resourceName: name,
        policyName: name,
        ruleName: "UNAUTHORIZED_POLICY_MUTATION",
        blockReason,
        metadata: {
          eventType,
          incidentType: "UNAUTHORIZED_POLICY_MUTATION",
          expectedHash,
          actualHash,
          driftDetectedAt: new Date().toISOString(),
        },
      });
    } catch (incidentErr) {
      this.logger.error(
        `[DriftDetector] Failed to record incident for ClusterPolicy ${clusterId}/${name}: ${
          incidentErr instanceof Error
            ? incidentErr.message
            : String(incidentErr)
        }`,
      );
    }

    // Auto-Heal
    let autoHealed = false;
    if (this.autoHealEnabled) {
      this.healingCooldownCache.set(cooldownKey, now);
      try {
        this.logger.log(
          `[DriftDetector] Auto-healing drift for ClusterPolicy '${name}' on cluster '${clusterId}'...`,
        );
        if (eventType === "delete") {
          await this.kyvernoAdapter.createClusterPolicy(
            clusterId,
            baselineManifest,
          );
        } else {
          await this.kyvernoAdapter.updateClusterPolicy(
            clusterId,
            name,
            baselineManifest,
          );
        }
        autoHealed = true;
        this.logger.log(
          `[DriftDetector] Successfully auto-healed ClusterPolicy '${name}' on cluster '${clusterId}'.`,
        );
      } catch (healErr) {
        this.logger.error(
          `[DriftDetector] Failed to auto-heal ClusterPolicy '${name}' on cluster '${clusterId}': ${
            healErr instanceof Error ? healErr.message : String(healErr)
          }`,
        );
      }
    }

    return {
      drifted: true,
      clusterId,
      resourceName: name,
      eventType,
      expectedHash,
      actualHash,
      autoHealed,
    };
  }

  /**
   * GitOps 정책 저장소(k8s-manifests/policies 또는 k8s-manifests/policies-hub-only)에서 원본 정책 YAML을 로드합니다.
   */
  loadGitOpsPolicyManifest(name: string): Record<string, unknown> | null {
    const baseCandidates = [
      path.resolve(process.cwd(), "k8s-manifests"),
      path.resolve(process.cwd(), "..", "k8s-manifests"),
      path.resolve(process.cwd(), "..", "..", "k8s-manifests"),
    ];
    let baseDir = baseCandidates[0];
    for (const c of baseCandidates) {
      if (fs.existsSync(c)) {
        baseDir = c;
        break;
      }
    }

    const possiblePaths = [
      path.join(baseDir, "policies", `${name}.yaml`),
      path.join(baseDir, "policies-hub-only", `${name}.yaml`),
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const loaded = yaml.load(raw) as Record<string, unknown>;
          if (loaded && typeof loaded === "object") {
            return loaded;
          }
        } catch {
          // ignore parse failure
        }
      }
    }

    return null;
  }
}
