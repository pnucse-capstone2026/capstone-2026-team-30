import { requestWithAuth } from "@/lib/api-client";

export type IncidentStatus =
  | "ACTIVE"
  | "RESOLVED_BY_EXCEPTION"
  | "RESOLVED_BY_HOTFIX"
  | "IGNORED";

export interface DeploymentIncident {
  id: string;
  clusterId: string;
  namespace: string;
  resourceKind: string;
  resourceName: string;
  policyName: string;
  ruleName?: string | null;
  blockReason: string;
  gitopsAppName?: string | null;
  gitCommitSha?: string | null;
  gitRepository?: string | null;
  status: IncidentStatus;
  blockCount: number;
  firstBlockedAt: string;
  lastBlockedAt: string;
  resolvedAt?: string | null;
  exceptionId?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedIncidents {
  items: DeploymentIncident[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListIncidentsParams {
  clusterId?: string;
  namespace?: string;
  status?: IncidentStatus;
  gitopsAppName?: string;
  policyName?: string;
  page?: number;
  limit?: number;
}

export interface RemediationDraft {
  suggestedExceptionYaml: string;
  autoFillUrl: string;
  remediationGuide: string;
  defaultTtlHours: number;
  incident: DeploymentIncident;
}

export interface EmergencyRemediateInput {
  reason: string;
  ttlHours?: number;
  publishToGitOps?: boolean;
}

export interface ResolveHotfixInput {
  commitSha?: string;
  note?: string;
}

/**
 * 배포 차단 인시던트 목록을 페이징 조회합니다.
 */
export async function listIncidents(
  params: ListIncidentsParams = {},
): Promise<PaginatedIncidents> {
  const query = new URLSearchParams();
  if (params.clusterId) query.set("clusterId", params.clusterId);
  if (params.namespace) query.set("namespace", params.namespace);
  if (params.status) query.set("status", params.status);
  if (params.gitopsAppName) query.set("gitopsAppName", params.gitopsAppName);
  if (params.policyName) query.set("policyName", params.policyName);
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));

  const queryString = query.toString();
  return requestWithAuth<PaginatedIncidents>(
    `/api/v1/incidents${queryString ? `?${queryString}` : ""}`,
  );
}

/**
 * 특정 배포 차단 인시던트의 상세 정보를 단일 조회합니다.
 */
export async function getIncidentById(id: string): Promise<DeploymentIncident> {
  return requestWithAuth<DeploymentIncident>(`/api/v1/incidents/${id}`);
}

/**
 * 특정 인시던트에 대한 자동 생성된 PolicyException YAML 초안 및 가이드(Remediation Draft)를 조회합니다.
 */
export async function getIncidentRemediationDraft(
  id: string,
): Promise<RemediationDraft> {
  return requestWithAuth<RemediationDraft>(
    `/api/v1/incidents/${id}/remediation-draft`,
  );
}

/**
 * 경로 B: 관리자 긴급 임시 예외를 발행하여 클러스터 런타임 적용 및 GitOps PR을 생성합니다.
 */
export async function remediateIncidentEmergency(
  id: string,
  body: EmergencyRemediateInput,
): Promise<DeploymentIncident> {
  return requestWithAuth<DeploymentIncident>(
    `/api/v1/incidents/${id}/remediate-emergency`,
    {
      method: "POST",
      body,
    },
  );
}

/**
 * 경로 C: 개발자의 매니페스트 핫픽스 수정 반영을 마킹하여 인시던트를 종결합니다.
 */
export async function resolveIncidentHotfix(
  id: string,
  body: ResolveHotfixInput = {},
): Promise<DeploymentIncident> {
  return requestWithAuth<DeploymentIncident>(
    `/api/v1/incidents/${id}/resolve-hotfix`,
    {
      method: "POST",
      body,
    },
  );
}

/**
 * 특정 인시던트를 수동 무시(IGNORED) 상태로 종결합니다.
 */
export async function ignoreIncident(
  id: string,
  body: { reason?: string } = {},
): Promise<DeploymentIncident> {
  return requestWithAuth<DeploymentIncident>(`/api/v1/incidents/${id}/ignore`, {
    method: "PATCH",
    body,
  });
}
