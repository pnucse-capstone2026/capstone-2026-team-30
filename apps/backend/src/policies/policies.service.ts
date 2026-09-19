import { forwardRef, Inject, Injectable, Optional } from "@nestjs/common";
import * as yaml from "js-yaml";
import { AuthenticatedUser } from "../auth/auth.types";
import { BusinessException } from "../common/errors/business.exception";
import { GitOpsPublisherService } from "../gitops/gitops-publisher.service";
import {
  ClusterMetadata,
  ClusterProvider,
} from "../kubernetes/cluster-provider";
import { KyvernoAdapter } from "../kubernetes/kyverno.adapter";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePolicyDto } from "./dto/create-policy.dto";
import {
  ListPoliciesQueryDto,
  PolicyScopeFilter,
} from "./dto/list-policies-query.dto";
import { PolicyDetailDto } from "./dto/policy-detail.dto";
import { PolicySummaryDto } from "./dto/policy-summary.dto";
import { UpdatePolicyDto } from "./dto/update-policy.dto";
import { POLICY_ERROR } from "./policy.errors";

type KubePolicyRaw = {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec?: {
    validationFailureAction?: string;
    rules?: Array<{
      name?: string;
      validate?: unknown;
      mutate?: unknown;
      generate?: unknown;
      verifyImages?: unknown;
    }>;
    [key: string]: unknown;
  };
  status?: {
    ready?: boolean;
    conditions?: Array<{ type?: string; status?: string }>;
    autogen?: {
      rules?: Array<{ name?: string }>;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Kyverno 정책 실시간 조회 및 분석 비즈니스 로직 서비스
 */
@Injectable()
export class PoliciesService {
  constructor(
    private readonly clusters: ClusterProvider,
    private readonly kyvernoAdapter: KyvernoAdapter,
    @Optional() private readonly prisma?: PrismaService,
    @Optional()
    @Inject(forwardRef(() => GitOpsPublisherService))
    private readonly gitOpsPublisher?: GitOpsPublisherService,
  ) {}

  /**
   * 사용자에게 허가된 클러스터 목록 전체 또는 특정 클러스터의 정책 목록을 실시간 조회합니다.
   *
   * @param user 인증된 요청자 정보 (배정된 clusterIds 포함)
   * @param query 검색 및 필터링 옵션 DTO
   * @returns 정책 요약 정보 배열
   */
  async list(
    user: AuthenticatedUser,
    query: ListPoliciesQueryDto,
  ): Promise<PolicySummaryDto[]> {
    const accessibleClusters = this.getAccessibleClusters(
      user,
      query.clusterId,
    );
    if (accessibleClusters.length === 0) {
      return [];
    }

    const allSummaries: PolicySummaryDto[] = [];

    for (const cluster of accessibleClusters) {
      try {
        const clusterPolicies =
          query.scope === PolicyScopeFilter.NAMESPACED
            ? []
            : await this.kyvernoAdapter.listClusterPolicies(cluster.id);

        const namespacedPolicies =
          query.scope === PolicyScopeFilter.CLUSTER
            ? []
            : await this.kyvernoAdapter.listNamespacedPolicies(
                cluster.id,
                query.namespace,
              );

        for (const raw of clusterPolicies) {
          const summary = this.mapToSummary(
            raw as KubePolicyRaw,
            cluster,
            "ClusterPolicy",
          );
          if (this.matchesFilter(summary, query)) {
            allSummaries.push(summary);
          }
        }

        for (const raw of namespacedPolicies) {
          const summary = this.mapToSummary(
            raw as KubePolicyRaw,
            cluster,
            "Policy",
          );
          if (this.matchesFilter(summary, query)) {
            allSummaries.push(summary);
          }
        }
      } catch {
        // 단일 클러스터 조회 실패가 전체 목록 조회를 중단시키지 않도록 격리 처리
        continue;
      }
    }

    return allSummaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 특정 클러스터에 배포된 Kyverno 정책의 상세 명세 및 규칙 목록을 조회합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param name 정책 이름
   * @param user 인증된 요청자 정보
   * @param namespace 네임스페이스 (Namespaced Policy인 경우 필수)
   * @returns 정책 상세 명세 DTO
   * @throws {BusinessException} 클러스터 미인가(POLICY_CLUSTER_ACCESS_DENIED) 또는 정책 미존재(POLICY_NOT_FOUND) 시
   */
  async getDetail(
    clusterId: string,
    name: string,
    user: AuthenticatedUser,
    namespace?: string,
  ): Promise<PolicyDetailDto> {
    const cluster = this.validateClusterAccess(user, clusterId);

    let rawPolicy: KubePolicyRaw | null = null;
    let scope: "ClusterPolicy" | "Policy" = "ClusterPolicy";

    if (namespace) {
      scope = "Policy";
      rawPolicy = (await this.kyvernoAdapter.getNamespacedPolicy(
        clusterId,
        namespace,
        name,
      )) as KubePolicyRaw | null;
    } else {
      rawPolicy = (await this.kyvernoAdapter.getClusterPolicy(
        clusterId,
        name,
      )) as KubePolicyRaw | null;

      // ClusterPolicy로 찾지 못한 경우 전체 네임스페이스에서 검색 시도
      if (!rawPolicy) {
        const namespaced =
          await this.kyvernoAdapter.listNamespacedPolicies(clusterId);
        const match = namespaced.find((item) => item.metadata?.name === name);
        if (match) {
          rawPolicy = match as KubePolicyRaw;
          scope = "Policy";
        }
      }
    }

    if (!rawPolicy) {
      throw new BusinessException(POLICY_ERROR.NOT_FOUND);
    }

    const summary = this.mapToSummary(rawPolicy, cluster, scope);
    const autogenRules = (rawPolicy.status?.autogen?.rules ?? [])
      .map((rule) => rule.name)
      .filter((ruleName): ruleName is string => Boolean(ruleName));

    return {
      ...summary,
      spec: rawPolicy.spec ?? {},
      autogenRules,
      rawJson: rawPolicy,
    };
  }

  /**
   * 신규 Kyverno 정책을 클러스터에 배포(생성)합니다.
   *
   * @param dto 정책 생성 요청 DTO
   * @param user 인증된 요청자 정보
   * @returns 생성된 정책 상세 정보 DTO
   * @throws {BusinessException} 클러스터 미인가, 필수값 누락, 이미 존재하는 정책, 생성 실패 시
   */
  async create(
    dto: CreatePolicyDto,
    user: AuthenticatedUser,
  ): Promise<PolicyDetailDto> {
    const cluster = this.validateClusterAccess(user, dto.clusterId);

    let manifest: Record<string, unknown>;
    let targetScope: "ClusterPolicy" | "Policy" = dto.scope;
    let targetNamespace = dto.namespace?.trim();

    if (dto.rawYaml?.trim()) {
      try {
        const parsed = yaml.load(dto.rawYaml.trim()) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") {
          throw new Error("YAML content is not a valid object");
        }
        manifest = parsed;
        if (parsed.kind === "Policy" || parsed.kind === "ClusterPolicy") {
          targetScope = parsed.kind as "ClusterPolicy" | "Policy";
        }
        const meta = parsed.metadata as Record<string, unknown> | undefined;
        if (meta?.namespace && typeof meta.namespace === "string") {
          targetNamespace = meta.namespace.trim();
        }
      } catch (err) {
        throw new BusinessException(POLICY_ERROR.INVALID_SPEC, {
          context: { reason: `Invalid YAML format: ${(err as Error).message}` },
        });
      }
    } else {
      if (dto.scope === "Policy" && !dto.namespace?.trim()) {
        throw new BusinessException(POLICY_ERROR.INVALID_SPEC, {
          context: { reason: "Namespace is required for namespaced Policy." },
        });
      }

      const kinds = dto.matchKinds
        .split(",")
        .map((kind) => kind.trim())
        .filter(Boolean);

      manifest = {
        apiVersion: "kyverno.io/v1",
        kind: dto.scope,
        metadata: {
          name: dto.name.trim(),
          ...(dto.scope === "Policy" && dto.namespace
            ? { namespace: dto.namespace.trim() }
            : {}),
          annotations: {
            ...(dto.description?.trim()
              ? { "policies.kyverno.io/description": dto.description.trim() }
              : {}),
          },
        },
        spec: {
          validationFailureAction: dto.mode === "enforce" ? "Enforce" : "Audit",
          background: true,
          rules: [
            {
              name: dto.ruleName.trim(),
              match: {
                any: [
                  {
                    resources: {
                      kinds: kinds.length > 0 ? kinds : ["Pod"],
                    },
                  },
                ],
              },
              [dto.type]: {
                message:
                  dto.message?.trim() ||
                  dto.description?.trim() ||
                  "Policy rule condition not satisfied",
                pattern: {
                  metadata: {
                    labels: {
                      app: "?*",
                    },
                  },
                },
              },
            },
          ],
        },
      };
    }

    let rawPolicy: KubePolicyRaw;
    try {
      if (targetScope === "Policy") {
        if (!targetNamespace) {
          throw new BusinessException(POLICY_ERROR.INVALID_SPEC, {
            context: { reason: "Namespace is required for namespaced Policy." },
          });
        }
        rawPolicy = (await this.kyvernoAdapter.createNamespacedPolicy(
          dto.clusterId,
          targetNamespace,
          manifest,
        )) as KubePolicyRaw;
      } else {
        rawPolicy = (await this.kyvernoAdapter.createClusterPolicy(
          dto.clusterId,
          manifest,
        )) as KubePolicyRaw;
      }
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code === 409) {
        throw new BusinessException(POLICY_ERROR.ALREADY_EXISTS, {
          cause: error,
          context: { clusterId: dto.clusterId, name: dto.name },
        });
      }
      if (code === 400) {
        throw new BusinessException(POLICY_ERROR.INVALID_SPEC, {
          cause: error,
          context: { clusterId: dto.clusterId, name: dto.name },
        });
      }
      throw new BusinessException(POLICY_ERROR.CREATE_FAILED, {
        cause: error,
        context: { clusterId: dto.clusterId, name: dto.name },
      });
    }

    // GitOps 퍼블리싱 연동 (백그라운드 비동기 처리)
    if (this.gitOpsPublisher) {
      void this.gitOpsPublisher
        .publishPolicyManifest(manifest, dto.clusterId)
        .catch(() => {});
    }

    // 감사 로그 기록
    if (this.prisma) {
      void this.prisma.auditLog
        .create({
          data: {
            action: "POLICY_CREATED",
            entityType: "POLICY",
            entityId: `${dto.clusterId}:${dto.scope}:${dto.name}`,
            actorType: "USER",
            userId: user.id,
            metadata: {
              clusterId: dto.clusterId,
              policyName: dto.name,
              scope: dto.scope,
              mode: dto.mode,
            },
          },
        })
        .catch(() => {});
    }

    const summary = this.mapToSummary(rawPolicy, cluster, dto.scope);
    return {
      ...summary,
      spec:
        (rawPolicy.spec as Record<string, unknown>) ??
        (manifest.spec as Record<string, unknown>),
      autogenRules: [],
      rawJson: rawPolicy,
    };
  }

  /**
   * 클러스터의 기존 Kyverno 정책을 수정(교체)합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param name 정책 이름
   * @param dto 정책 수정 요청 DTO
   * @param user 인증된 요청자 정보
   * @param namespace 네임스페이스 (Namespaced Policy인 경우)
   * @returns 수정된 정책 상세 정보 DTO
   */
  async update(
    clusterId: string,
    name: string,
    dto: UpdatePolicyDto,
    user: AuthenticatedUser,
    namespace?: string,
  ): Promise<PolicyDetailDto> {
    const cluster = this.validateClusterAccess(user, clusterId);

    // 기존 정책 조회
    const existing = await this.getDetail(clusterId, name, user, namespace);
    const scope = existing.scope;
    const targetNamespace = namespace || existing.namespace || undefined;

    let manifest: Record<string, unknown>;

    if (dto.manifest) {
      manifest = dto.manifest;
    } else if (dto.rawYaml?.trim()) {
      try {
        const parsed = yaml.load(dto.rawYaml.trim()) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") {
          throw new Error("YAML content is not a valid object");
        }
        manifest = parsed;
      } catch (err) {
        throw new BusinessException(POLICY_ERROR.INVALID_SPEC, {
          context: { reason: `Invalid YAML format: ${(err as Error).message}` },
        });
      }
    } else {
      const existingRaw = (existing.rawJson as Record<string, unknown>) || {};
      const existingMeta =
        (existingRaw.metadata as Record<string, unknown>) || {};
      const existingSpec = (existingRaw.spec as Record<string, unknown>) || {};
      const existingAnnotations =
        (existingMeta.annotations as Record<string, string>) || {};

      manifest = {
        ...existingRaw,
        metadata: {
          ...existingMeta,
          name,
          ...(targetNamespace ? { namespace: targetNamespace } : {}),
          annotations: {
            ...existingAnnotations,
            ...(dto.description
              ? { "policies.kyverno.io/description": dto.description }
              : {}),
          },
        },
        spec: {
          ...existingSpec,
          ...(dto.mode
            ? {
                validationFailureAction:
                  dto.mode === "enforce" ? "Enforce" : "Audit",
              }
            : {}),
        },
      };
    }

    let rawPolicy: KubePolicyRaw;
    try {
      if (scope === "Policy" && targetNamespace) {
        rawPolicy = (await this.kyvernoAdapter.updateNamespacedPolicy(
          clusterId,
          targetNamespace,
          name,
          manifest,
        )) as KubePolicyRaw;
      } else {
        rawPolicy = (await this.kyvernoAdapter.updateClusterPolicy(
          clusterId,
          name,
          manifest,
        )) as KubePolicyRaw;
      }
    } catch (error) {
      throw new BusinessException(POLICY_ERROR.UPDATE_FAILED, {
        cause: error,
        context: { clusterId, name },
      });
    }

    // GitOps 퍼블리싱 연동
    if (this.gitOpsPublisher) {
      void this.gitOpsPublisher
        .publishPolicyManifest(manifest, clusterId)
        .catch(() => {});
    }

    // 감사 로그 기록
    if (this.prisma) {
      void this.prisma.auditLog
        .create({
          data: {
            action: "POLICY_UPDATED",
            entityType: "POLICY",
            entityId: `${clusterId}:${scope}:${name}`,
            actorType: "USER",
            userId: user.id,
            metadata: {
              clusterId,
              policyName: name,
              scope,
              mode: dto.mode || existing.mode,
            },
          },
        })
        .catch(() => {});
    }

    const summary = this.mapToSummary(rawPolicy, cluster, scope);
    return {
      ...summary,
      spec: (rawPolicy.spec as Record<string, unknown>) ?? {},
      autogenRules: [],
      rawJson: rawPolicy,
    };
  }

  /**
   * 클러스터에서 특정 Kyverno 정책을 삭제합니다.
   *
   * @param clusterId 대상 클러스터 식별자
   * @param name 정책 이름
   * @param user 인증된 요청자 정보
   * @param namespace 네임스페이스 (Namespaced Policy인 경우)
   */
  async delete(
    clusterId: string,
    name: string,
    user: AuthenticatedUser,
    namespace?: string,
  ): Promise<{ success: boolean; name: string }> {
    this.validateClusterAccess(user, clusterId);

    const existing = await this.getDetail(clusterId, name, user, namespace);
    const scope = existing.scope;
    const targetNamespace = namespace || existing.namespace || undefined;

    try {
      if (scope === "Policy" && targetNamespace) {
        await this.kyvernoAdapter.deleteNamespacedPolicy(
          clusterId,
          targetNamespace,
          name,
        );
      } else {
        await this.kyvernoAdapter.deleteClusterPolicy(clusterId, name);
      }
    } catch (error) {
      throw new BusinessException(POLICY_ERROR.DELETE_FAILED, {
        cause: error,
        context: { clusterId, name },
      });
    }

    // GitOps 파일 제거 연동
    if (this.gitOpsPublisher) {
      void this.gitOpsPublisher.unpublishPolicyManifest(name).catch(() => {});
    }

    // 감사 로그 기록
    if (this.prisma) {
      void this.prisma.auditLog
        .create({
          data: {
            action: "POLICY_DELETED",
            entityType: "POLICY",
            entityId: `${clusterId}:${scope}:${name}`,
            actorType: "USER",
            userId: user.id,
            metadata: {
              clusterId,
              policyName: name,
              scope,
            },
          },
        })
        .catch(() => {});
    }

    return { success: true, name };
  }

  private validateClusterAccess(
    user: AuthenticatedUser,
    clusterId: string,
  ): ClusterMetadata {
    if (user.role !== "ADMIN" && !user.clusterIds.includes(clusterId)) {
      throw new BusinessException(POLICY_ERROR.CLUSTER_ACCESS_DENIED);
    }
    const all = this.clusters.list();
    const cluster = all.find((c) => c.id === clusterId);
    if (!cluster) {
      throw new BusinessException(POLICY_ERROR.CLUSTER_ACCESS_DENIED);
    }
    return cluster;
  }

  private getAccessibleClusters(
    user: AuthenticatedUser,
    targetClusterId?: string,
  ): ClusterMetadata[] {
    const all = this.clusters.list();
    const userClusters =
      user.role === "ADMIN"
        ? all
        : all.filter((c) => user.clusterIds.includes(c.id));

    if (targetClusterId) {
      return userClusters.filter((c) => c.id === targetClusterId);
    }
    return userClusters;
  }

  private mapToSummary(
    raw: KubePolicyRaw,
    cluster: ClusterMetadata,
    scope: "ClusterPolicy" | "Policy",
  ): PolicySummaryDto {
    const name = raw.metadata?.name ?? "unnamed";
    const namespace = raw.metadata?.namespace ?? null;
    const action = raw.spec?.validationFailureAction?.toLowerCase();
    const mode: "enforce" | "audit" =
      action === "enforce" ? "enforce" : "audit";

    const rules = raw.spec?.rules ?? [];
    const ruleNames = rules
      .map((rule) => rule.name)
      .filter((ruleName): ruleName is string => Boolean(ruleName));

    let type: "validate" | "mutate" | "generate" | "verifyImages" = "validate";
    if (rules.some((rule) => Boolean(rule.mutate))) {
      type = "mutate";
    } else if (rules.some((rule) => Boolean(rule.generate))) {
      type = "generate";
    } else if (rules.some((rule) => Boolean(rule.verifyImages))) {
      type = "verifyImages";
    }

    const annotations = raw.metadata?.annotations ?? {};
    const description =
      annotations["policies.kyverno.io/description"] ||
      annotations["policies.kyverno.io/title"] ||
      annotations["description"] ||
      `${name} policy`;

    const isReady =
      raw.status?.ready ??
      raw.status?.conditions?.some(
        (c) => c.type === "Ready" && c.status === "True",
      ) ??
      true;

    const id = `${cluster.id}:${scope}:${namespace ?? ""}:${name}`;

    return {
      id,
      name,
      clusterId: cluster.id,
      clusterDisplayName: cluster.displayName,
      scope,
      namespace,
      mode,
      type,
      ruleCount: ruleNames.length,
      rules: ruleNames,
      status: isReady ? "active" : "warning",
      description,
      createdAt: raw.metadata?.creationTimestamp ?? new Date().toISOString(),
    };
  }

  private matchesFilter(
    summary: PolicySummaryDto,
    query: ListPoliciesQueryDto,
  ): boolean {
    if (query.namespace && summary.namespace !== query.namespace) {
      return false;
    }
    if (query.type && summary.type !== (query.type as string)) {
      return false;
    }
    if (query.mode && summary.mode !== (query.mode as string)) {
      return false;
    }
    if (query.scope && summary.scope !== (query.scope as string)) {
      return false;
    }
    if (query.search) {
      const term = query.search.toLowerCase();
      const matched =
        summary.name.toLowerCase().includes(term) ||
        summary.description.toLowerCase().includes(term) ||
        summary.rules.some((r) => r.toLowerCase().includes(term));
      if (!matched) return false;
    }
    return true;
  }
}
