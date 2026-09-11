import { AI_AGENT_ERROR } from "../../ai-agent/ai-agent.errors";
import { AUDIT_LOG_ERROR } from "../../audit-logs/audit-logs.errors";
import { AUTH_ERROR } from "../../auth/auth.errors";
import { EXCEPTION_LIFECYCLE_ERROR } from "../../exception-lifecycle/exception-lifecycle.errors";
import { EXCEPTION_REQUEST_ERROR } from "../../exception-requests/exception-request.errors";
import { KUBERNETES_ERROR } from "../../kubernetes/kubernetes.errors";
import { MLOPS_ERROR } from "../../mlops/mlops.errors";
import { NOTIFICATION_ERROR } from "../../notifications/notifications.errors";
import { POLICY_ERROR } from "../../policies/policy.errors";
import { SIMULATION_ERROR } from "../../simulation/simulation.errors";
import { USER_ERROR } from "../../users/user.errors";
import { VIOLATION_ERROR } from "../../violations/violation.errors";

export const BUSINESS_ERRORS = [
  ...Object.values(AI_AGENT_ERROR),
  ...Object.values(AUDIT_LOG_ERROR),
  ...Object.values(AUTH_ERROR),
  ...Object.values(USER_ERROR),
  ...Object.values(EXCEPTION_LIFECYCLE_ERROR),
  ...Object.values(EXCEPTION_REQUEST_ERROR),
  ...Object.values(KUBERNETES_ERROR),
  ...Object.values(MLOPS_ERROR),
  ...Object.values(NOTIFICATION_ERROR),
  ...Object.values(POLICY_ERROR),
  ...Object.values(SIMULATION_ERROR),
  ...Object.values(VIOLATION_ERROR),
] as const;

export type BusinessError = (typeof BUSINESS_ERRORS)[number];

export type BusinessErrorCode = BusinessError["code"];
