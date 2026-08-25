import { requestWithAuth } from "@/lib/api-client";
import {
  type ExceptionRequest,
  type ExceptionRequestStatus,
} from "@/lib/exception-requests";

export type BackendExceptionStatus =
  | "PENDING"
  | "APPLYING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLING"
  | "EXPIRING"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED";

export type BackendExceptionRequest = {
  id: string;
  status: BackendExceptionStatus;
  reason: string;
  policyName: string;
  ruleNames: string[];
  appliedRuleNames: string[];
  resourceKind: string;
  resourceName: string;
  resourceNamespace: string | null;
  targetClusterId: string;
  targetClusterDisplayName: string;
  k8sExceptionName: string;
  expiresAt: string;
  decisionNote: string | null;
  decidedAt: string | null;
  activatedAt: string | null;
  applyAttempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  requestUserId: string;
  approverUserId: string | null;
};

export type CreateExceptionRequestInput = {
  policyName: string;
  ruleNames: string[];
  reason: string;
  resourceKind: string;
  resourceName: string;
  resourceNamespace?: string;
  targetClusterId: string;
  expiresAt: string;
};

export type DecideExceptionRequestInput = {
  decisionNote?: string;
  ruleNames?: string[];
};

export function toExceptionRequestStatus(
  status: BackendExceptionStatus,
): ExceptionRequestStatus {
  return status.toLowerCase() as ExceptionRequestStatus;
}

function formatDate(value: string) {
  return value.slice(0, 10);
}

export function toExceptionRequest(
  request: BackendExceptionRequest,
): ExceptionRequest {
  return {
    id: request.id,
    policyName: request.policyName,
    ruleNames: request.ruleNames,
    appliedRuleNames: request.appliedRuleNames,
    resourceKind: request.resourceKind,
    resourceName: request.resourceName,
    namespace: request.resourceNamespace ?? "-",
    targetClusterId: request.targetClusterId,
    targetClusterDisplayName: request.targetClusterDisplayName,
    clusterName: request.targetClusterDisplayName,
    k8sExceptionName: request.k8sExceptionName,
    requester: request.requestUserId,
    team: "-",
    reason: request.reason,
    requestedAt: formatDate(request.createdAt),
    expiresAt: formatDate(request.expiresAt),
    status: toExceptionRequestStatus(request.status),
    reviewer: request.approverUserId ?? "-",
    decisionNote: request.decisionNote,
    decidedAt: request.decidedAt ? formatDate(request.decidedAt) : null,
    activatedAt: request.activatedAt ? formatDate(request.activatedAt) : null,
    applyAttempts: request.applyAttempts,
    lastError: request.lastError,
    nextAttemptAt: request.nextAttemptAt
      ? formatDate(request.nextAttemptAt)
      : null,
    riskLevel: "medium",
    compensatingControl: request.decisionNote ?? "-",
  };
}

export async function listExceptionRequests() {
  const requests = await requestWithAuth<BackendExceptionRequest[]>(
    "/exception-requests",
  );

  return requests.map(toExceptionRequest);
}

export async function getExceptionRequest(id: string) {
  const request = await requestWithAuth<BackendExceptionRequest>(
    `/exception-requests/${id}`,
  );

  return toExceptionRequest(request);
}

export function createExceptionRequest(data: CreateExceptionRequestInput) {
  return requestWithAuth<BackendExceptionRequest>("/exception-requests", {
    method: "POST",
    body: data,
  });
}

export function approveExceptionRequest(
  id: string,
  data: DecideExceptionRequestInput = {},
) {
  return requestWithAuth<BackendExceptionRequest>(
    `/exception-requests/${id}/approve`,
    {
      method: "PATCH",
      body: data,
    },
  );
}

export function rejectExceptionRequest(
  id: string,
  data: Pick<DecideExceptionRequestInput, "decisionNote"> = {},
) {
  return requestWithAuth<BackendExceptionRequest>(
    `/exception-requests/${id}/reject`,
    {
      method: "PATCH",
      body: data,
    },
  );
}

export function cancelExceptionRequest(id: string) {
  return requestWithAuth<BackendExceptionRequest>(
    `/exception-requests/${id}/cancel`,
    {
      method: "PATCH",
    },
  );
}

export function retryExceptionRequest(id: string) {
  return requestWithAuth<BackendExceptionRequest>(
    `/exception-requests/${id}/retry`,
    {
      method: "PATCH",
    },
  );
}
