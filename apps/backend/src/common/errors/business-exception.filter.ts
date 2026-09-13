import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { AI_AGENT_ERROR } from "../../ai-agent/ai-agent.errors";
import { AUDIT_LOG_ERROR } from "../../audit-logs/audit-logs.errors";
import { AUTH_ERROR } from "../../auth/auth.errors";
import { EXCEPTION_LIFECYCLE_ERROR } from "../../exception-lifecycle/exception-lifecycle.errors";
import { EXCEPTION_REQUEST_ERROR } from "../../exception-requests/exception-request.errors";
import { GITOPS_ERROR } from "../../gitops/gitops.errors";
import { INCIDENT_ERROR } from "../../incidents/incidents.errors";
import { KUBERNETES_ERROR } from "../../kubernetes/kubernetes.errors";
import { MLOPS_ERROR } from "../../mlops/mlops.errors";
import { NOTIFICATION_ERROR } from "../../notifications/notifications.errors";
import { POLICY_ERROR } from "../../policies/policy.errors";
import { SIMULATION_ERROR } from "../../simulation/simulation.errors";
import { USER_ERROR } from "../../users/user.errors";
import { VIOLATION_ERROR } from "../../violations/violation.errors";
import type { BusinessErrorCode } from "./business-error-catalog";
import { BusinessException } from "./business.exception";

export const BUSINESS_ERROR_HTTP_STATUS = {
  [AI_AGENT_ERROR.ANALYSIS_FAILED.code]: HttpStatus.INTERNAL_SERVER_ERROR,
  [AI_AGENT_ERROR.EVALUATION_FAILED.code]: HttpStatus.BAD_REQUEST,
  [AI_AGENT_ERROR.TIMEOUT.code]: HttpStatus.GATEWAY_TIMEOUT,
  [AUDIT_LOG_ERROR.NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [AUDIT_LOG_ERROR.INVALID_DATE_RANGE.code]: HttpStatus.BAD_REQUEST,
  [AUTH_ERROR.INVALID_CREDENTIALS.code]: HttpStatus.UNAUTHORIZED,
  [AUTH_ERROR.INVALID_REFRESH_TOKEN.code]: HttpStatus.UNAUTHORIZED,
  [AUTH_ERROR.AUTHENTICATION_REQUIRED.code]: HttpStatus.UNAUTHORIZED,
  [AUTH_ERROR.SESSION_EXPIRED.code]: HttpStatus.UNAUTHORIZED,
  [AUTH_ERROR.INSUFFICIENT_PERMISSIONS.code]: HttpStatus.FORBIDDEN,
  [USER_ERROR.EMAIL_ALREADY_EXISTS.code]: HttpStatus.CONFLICT,
  [USER_ERROR.NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [EXCEPTION_LIFECYCLE_ERROR.REQUEST_NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [EXCEPTION_REQUEST_ERROR.EXPIRED.code]: HttpStatus.BAD_REQUEST,
  [EXCEPTION_REQUEST_ERROR.APPROVED_RULES_INVALID.code]: HttpStatus.BAD_REQUEST,
  [EXCEPTION_REQUEST_ERROR.POLICY_NOT_FOUND.code]: HttpStatus.BAD_REQUEST,
  [EXCEPTION_REQUEST_ERROR.POLICY_RULE_VALIDATION_FAILED.code]:
    HttpStatus.BAD_REQUEST,
  [EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE.code]:
    HttpStatus.BAD_GATEWAY,
  [EXCEPTION_REQUEST_ERROR.SELF_DECISION_FORBIDDEN.code]: HttpStatus.FORBIDDEN,
  [EXCEPTION_REQUEST_ERROR.EXPIRATION_MUST_BE_FUTURE.code]:
    HttpStatus.BAD_REQUEST,
  [EXCEPTION_REQUEST_ERROR.EXPIRATION_TOO_LONG.code]: HttpStatus.BAD_REQUEST,
  [EXCEPTION_REQUEST_ERROR.RULE_NAMES_REQUIRED.code]: HttpStatus.BAD_REQUEST,
  [EXCEPTION_LIFECYCLE_ERROR.INVALID_TRANSITION.code]: HttpStatus.CONFLICT,
  [GITOPS_ERROR.PR_REVIEW_FAILED.code]: HttpStatus.INTERNAL_SERVER_ERROR,
  [GITOPS_ERROR.INVALID_MANIFEST.code]: HttpStatus.BAD_REQUEST,
  [GITOPS_ERROR.GITHUB_API_ERROR.code]: HttpStatus.BAD_GATEWAY,
  [GITOPS_ERROR.UNAUTHORIZED_CI_TOKEN.code]: HttpStatus.UNAUTHORIZED,
  [GITOPS_ERROR.CLUSTER_NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [INCIDENT_ERROR.NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [INCIDENT_ERROR.CLUSTER_ACCESS_DENIED.code]: HttpStatus.FORBIDDEN,
  [INCIDENT_ERROR.ALREADY_RESOLVED.code]: HttpStatus.BAD_REQUEST,
  [INCIDENT_ERROR.INVALID_STATUS_TRANSITION.code]: HttpStatus.CONFLICT,
  [KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED.code]: HttpStatus.NOT_FOUND,
  [MLOPS_ERROR.NOTEBOOK_NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [MLOPS_ERROR.NOTEBOOK_ALREADY_EXISTS.code]: HttpStatus.CONFLICT,
  [MLOPS_ERROR.GPU_QUOTA_EXCEEDED.code]: HttpStatus.BAD_REQUEST,
  [MLOPS_ERROR.CLUSTER_ACCESS_DENIED.code]: HttpStatus.FORBIDDEN,
  [MLOPS_ERROR.INVALID_PRESET.code]: HttpStatus.BAD_REQUEST,
  [MLOPS_ERROR.NOTEBOOK_CREATION_FAILED.code]: HttpStatus.INTERNAL_SERVER_ERROR,
  [MLOPS_ERROR.ML_POLICY_VIOLATION.code]: HttpStatus.BAD_REQUEST,
  [MLOPS_ERROR.GOVERNANCE_SETTINGS_INVALID.code]: HttpStatus.BAD_REQUEST,
  [MLOPS_ERROR.IDLE_MONITOR_FAILED.code]: HttpStatus.INTERNAL_SERVER_ERROR,
  [MLOPS_ERROR.INVALID_MODEL_PATH.code]: HttpStatus.BAD_REQUEST,
  [MLOPS_ERROR.SERVING_DEPLOYMENT_FAILED.code]:
    HttpStatus.INTERNAL_SERVER_ERROR,
  [MLOPS_ERROR.PIPELINE_RUN_FAILED.code]: HttpStatus.INTERNAL_SERVER_ERROR,
  [NOTIFICATION_ERROR.NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [POLICY_ERROR.NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [POLICY_ERROR.CLUSTER_ACCESS_DENIED.code]: HttpStatus.FORBIDDEN,
  [POLICY_ERROR.LOOKUP_FAILED.code]: HttpStatus.BAD_GATEWAY,
  [POLICY_ERROR.ALREADY_EXISTS.code]: HttpStatus.CONFLICT,
  [POLICY_ERROR.INVALID_SPEC.code]: HttpStatus.BAD_REQUEST,
  [POLICY_ERROR.CREATE_FAILED.code]: HttpStatus.INTERNAL_SERVER_ERROR,
  [SIMULATION_ERROR.INVALID_YAML.code]: HttpStatus.BAD_REQUEST,
  [SIMULATION_ERROR.SCENARIO_NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [SIMULATION_ERROR.DEPLOYMENT_FAILED.code]: HttpStatus.INTERNAL_SERVER_ERROR,
  [SIMULATION_ERROR.CLEANUP_FAILED.code]: HttpStatus.INTERNAL_SERVER_ERROR,
  [VIOLATION_ERROR.NOT_FOUND.code]: HttpStatus.NOT_FOUND,
  [VIOLATION_ERROR.CLUSTER_ACCESS_DENIED.code]: HttpStatus.FORBIDDEN,
  [VIOLATION_ERROR.REPORT_LOOKUP_FAILED.code]: HttpStatus.BAD_GATEWAY,
} as const satisfies Record<BusinessErrorCode, HttpStatus>;

/**
 * 프로덕션 로그 레벨(info)에서도 남겨야 하는 권한 거부 코드. 인증 실패(401)는
 * 토큰 만료처럼 일상적인 사건이라 제외하고, 실제로 권한이 없어 막힌 403 만 넣는다.
 * `context` 에 담기는 것은 없거나 `{requestId, userId}` 뿐이다 — userId 는 이메일
 * 같은 직접 식별자가 아니라 연결 가능한 가명 식별자이고, 감사 기록으로서 의도된
 * 것이다.
 */
const AUTHZ_DENIAL_CODES: ReadonlySet<string> = new Set([
  AUTH_ERROR.INSUFFICIENT_PERMISSIONS.code,
  EXCEPTION_REQUEST_ERROR.SELF_DECISION_FORBIDDEN.code,
]);

const MAX_CAUSE_MESSAGE_LENGTH = 500;
const MAX_CAUSE_BODY_LENGTH = 2_000;
const MAX_CAUSE_STACK_LENGTH = 4_000;
const MAX_CAUSE_DEPTH = 2;
const UNREADABLE = Symbol("unreadable");

type CauseSummary = {
  type: string;
  message: string;
  stack?: string;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  statusCode?: unknown;
  body?: unknown;
  cause?: CauseSummary | string;
};

function truncate(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}… (truncated)`;
}

/**
 * 외부 프로세스와 kubeconfig 인증 플러그인의 오류 문구는 신뢰할 수 없는 자유
 * 텍스트다. 흔한 자격증명 표기와 PEM/JWT를 먼저 지운 뒤 길이를 제한한다.
 */
function sanitizeText(value: string, limit: number): string {
  const redacted = value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*(?![A-Za-z0-9_-])/g,
      "[REDACTED JWT]",
    )
    .replace(
      /(["']?(?:authorization|[A-Za-z0-9_.-]*(?:token|secret|password|api[-_]?key|client[-_]?key[-_]?data)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      "$1[REDACTED]",
    );

  return truncate(redacted, limit);
}

function readProperty(
  value: object,
  property: PropertyKey,
): unknown | typeof UNREADABLE {
  try {
    return Reflect.get(value, property);
  } catch {
    return UNREADABLE;
  }
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unserializable value]";
  }
}

function summarizeScalar(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeText(value, MAX_CAUSE_MESSAGE_LENGTH);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value === undefined) return undefined;
  return "[non-scalar]";
}

/**
 * js-yaml 의 `YAMLException` 은 message 에 원본 문서 조각(`mark.snippet`)을 끼워
 * 넣는다. 깨진 kubeconfig 를 읽다 던져진 경우 그 조각에 `token` 이나
 * `client-key-data` 가 들어 있으므로, mark 를 가진 예외는 message 대신 사람이 쓴
 * `reason` 만 남긴다.
 *
 * `snippetRedacted` 를 함께 돌려주는 이유: `Error.prototype.stack` 은 첫 줄이
 * `${name}: ${message}` 라서 message 를 정화해도 스택에 조각이 그대로 남는다.
 * 조각을 지운 경우에는 스택도 버려야 한다.
 */
function causeMessage(cause: Error): {
  message: string;
  rawMessage: string;
  snippetRedacted: boolean;
} {
  const rawMessageValue = readProperty(cause, "message");
  const rawMessage =
    typeof rawMessageValue === "string"
      ? rawMessageValue
      : rawMessageValue === UNREADABLE
        ? "[unreadable message]"
        : safeString(rawMessageValue);
  const reason = readProperty(cause, "reason");
  const mark = readProperty(cause, "mark");

  if (mark !== UNREADABLE && mark !== undefined && typeof reason === "string") {
    return {
      message: sanitizeText(reason, MAX_CAUSE_MESSAGE_LENGTH),
      rawMessage,
      snippetRedacted: true,
    };
  }

  return {
    message: sanitizeText(rawMessage, MAX_CAUSE_MESSAGE_LENGTH),
    rawMessage,
    snippetRedacted: false,
  };
}

/**
 * V8 스택의 헤더는 `${name}: ${message}` 이며 message가 여러 줄일 수도 있다.
 * 헤더를 정확히 제거할 수 있을 때만 프레임을 남긴다. 형식을 추측해 첫 줄만
 * 자르면 여러 줄짜리 비밀이 다시 로그로 들어갈 수 있다.
 */
function summarizeStack(
  cause: Error,
  type: string,
  rawMessage: string,
): string | undefined {
  const stack = readProperty(cause, "stack");
  if (typeof stack !== "string") return undefined;

  const header = `${type}: ${rawMessage}`;
  if (!stack.startsWith(header)) return undefined;

  const frames = stack.slice(header.length).replace(/^\n+/, "");
  return frames.length > 0
    ? sanitizeText(frames, MAX_CAUSE_STACK_LENGTH)
    : undefined;
}

/**
 * apiserver 의 Status 는 진단에 그대로 쓰이므로 필드를 골라 남기고, 그 밖의 본문
 * (프록시가 끼어들어 HTML 을 돌려주는 경우 등)은 잘라 담는다. 로그 한 줄이 수백
 * KB 가 되면 대부분의 수집기가 레코드째로 버린다.
 */
function summarizeBody(body: unknown): unknown {
  if (typeof body === "string")
    return sanitizeText(body, MAX_CAUSE_BODY_LENGTH);
  if (body === null || typeof body !== "object") return body;

  const kind = readProperty(body, "kind");
  if (kind === "Status") {
    const code = readProperty(body, "code");
    const reason = readProperty(body, "reason");
    const message = readProperty(body, "message");

    return {
      kind,
      code: code === UNREADABLE ? "[unreadable]" : summarizeScalar(code),
      reason: reason === UNREADABLE ? "[unreadable]" : summarizeScalar(reason),
      message:
        message === UNREADABLE ? "[unreadable]" : summarizeScalar(message),
    };
  }

  try {
    return sanitizeText(JSON.stringify(body) ?? "", MAX_CAUSE_BODY_LENGTH);
  } catch {
    return "[unserializable body]";
  }
}

function summarize(
  cause: unknown,
  depth: number,
): CauseSummary | string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (!(cause instanceof Error)) {
    return sanitizeText(safeString(cause), MAX_CAUSE_MESSAGE_LENGTH);
  }

  const name = readProperty(cause, "name");
  const type =
    typeof name === "string" && name.length > 0
      ? sanitizeText(name, MAX_CAUSE_MESSAGE_LENGTH)
      : "Error";
  const { message, rawMessage, snippetRedacted } = causeMessage(cause);
  const summary: CauseSummary = { type, message };

  // 정화한 메시지가 원문과 다른 YAMLException은 스택 전체를 버린다. 그 밖에는
  // 원문 헤더를 제거한 프레임만 길이를 제한해 남긴다.
  if (!snippetRedacted) {
    const stack = summarizeStack(cause, type, rawMessage);
    if (stack !== undefined) summary.stack = stack;
  }

  // Node 시스템 오류의 판별자 — ECONNREFUSED, CERT_HAS_EXPIRED 등은 message 에
  // 코드가 없는 경우가 있어 이 필드가 유일한 기계 판독 수단이다.
  for (const property of ["code", "errno", "syscall", "statusCode"] as const) {
    const value = readProperty(cause, property);
    if (value !== UNREADABLE && value !== undefined) {
      summary[property] = summarizeScalar(value);
    }
  }

  const body = readProperty(cause, "body");
  if (body !== UNREADABLE && body !== undefined) {
    summary.body = summarizeBody(body);
  }

  if (depth < MAX_CAUSE_DEPTH) {
    const nestedCause = readProperty(cause, "cause");
    const nested =
      nestedCause === UNREADABLE
        ? "[unreadable cause]"
        : summarize(nestedCause, depth + 1);
    if (nested !== undefined) summary.cause = nested;
  }

  return summary;
}

/**
 * `cause` 를 pino 에 그대로 넘기면 안 된다. pino 의 err 시리얼라이저는 own
 * enumerable 프로퍼티를 전부 복사한다(pino-std-serializers err.js 의
 * `for (const key in err)`). @kubernetes/client-node 1.x 의 `ApiException` 은
 * own enumerable 로 `code`/`body`/`headers` 를 들고 있는데, 이 중 `headers` 는
 * 응답 헤더라 자격증명이 실릴 여지가 있고 `body` 도 서버가 돌려준 임의의 내용이다.
 * (0.22 의 `HttpError` 는 여기에 더해 `response.request.headers.Authorization` 으로
 * 서비스 어카운트 토큰까지 매달고 있었다.)
 *
 * 그래서 통째로 넘기지 않고 필요한 필드만 골라 담는다 — `headers` 는 고르지 않는다.
 * `ApiException` 은 실제 사유가 message 가 아니라 `code`/`body` 에 있으므로 그 둘은
 * 포함한다. Error 가 아닌 cause 는 임의의 객체 그래프를 흘리지 않도록 문자열로
 * 축약한다 — 진단 정보가 필요하면 호출부에서 Error 로 감싸야 한다.
 *
 * 결과를 `err` 키로 싣지 않는 이유: pino 는 `message` 가 문자열인 값이면 무엇이든
 * 오류로 간주해(`isErrorLike`) `type` 을 생성자 이름으로 덮어쓴다. 손으로 만든
 * 요약 객체의 생성자는 `Object` 이므로 `type` 이 항상 `"Object"` 가 되어 원래
 * 클래스 이름을 잃는다. `cause` 키에는 기본 시리얼라이저가 없어 그대로 실린다.
 *
 * 전체를 try 로 감싼다. 진단 정보를 얻으려다 던지면 필터가 중단되고 클라이언트는
 * 비즈니스 코드 없는 500 을 받으며 로그도 남지 않는다 — 이 함수는 응답보다 먼저
 * 실행되므로 절대 던지면 안 된다.
 */
function summarizeCause(cause: unknown): CauseSummary | string | undefined {
  try {
    return summarize(cause, 0);
  } catch {
    return "[unserializable cause]";
  }
}

function httpErrorName(status: HttpStatus): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "Bad Request";
    case HttpStatus.UNAUTHORIZED:
      return "Unauthorized";
    case HttpStatus.FORBIDDEN:
      return "Forbidden";
    case HttpStatus.NOT_FOUND:
      return "Not Found";
    case HttpStatus.CONFLICT:
      return "Conflict";
    case HttpStatus.BAD_GATEWAY:
      return "Bad Gateway";
    default:
      return "Error";
  }
}

@Catch(BusinessException)
export class BusinessExceptionFilter implements ExceptionFilter<BusinessException> {
  private readonly logger = new Logger(BusinessExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: BusinessException, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const status = BUSINESS_ERROR_HTTP_STATUS[exception.code];
    const { httpAdapter } = this.adapterHost;

    this.log(exception, status);

    httpAdapter.reply(
      context.getResponse(),
      {
        statusCode: status,
        error: httpErrorName(status),
        code: exception.code,
        message: exception.message,
      },
      status,
    );
  }

  /**
   * 응답 본문에는 진단 정보를 싣지 않으므로(내부 정보 노출 방지) `cause` 와
   * `context` 는 로그가 유일한 기록 지점이다. 레벨은 세 갈래다.
   *
   * - 5xx: 원인 추적이 필요하므로 error.
   * - 권한 거부(403): 거버넌스 감사 대상이라 프로덕션 로그 레벨(info)에서도
   *   남아야 하므로 warn.
   * - 그 밖의 4xx: 로그인 실패나 404처럼 정상 흐름이 섞여 있어 debug. 이 덕에
   *   `context` 에 담긴 PII(users.service 의 email)가 프로덕션에서 출력되지
   *   않는다 — `SENSITIVE_HTTP_LOG_PATHS` 의 redact 는 HTTP 헤더 경로만
   *   가리므로 로그 페이로드는 이 레벨 구분으로 방어한다.
   *
   * 페이로드 키 이름을 `context` 로 쓰면 안 된다. nestjs-pino 는 로거 이름을
   * `context` 필드에 넣은 뒤 이 객체를 그 위에 Object.assign 하므로
   * (node_modules/nestjs-pino/Logger.js), 어느 클래스가 남긴 로그인지가 지워지고
   * `context` 가 문자열/객체를 번갈아 갖게 된다.
   */
  private log(exception: BusinessException, status: HttpStatus): void {
    const cause = summarizeCause(exception.cause);
    const payload = {
      code: exception.code,
      statusCode: status,
      errorContext: exception.context,
      cause,
      // cause 가 없는 5xx 는 위치 정보가 아예 없어지므로 자체 스택을 남긴다.
      // 4xx 에는 붙이지 않는다 — 로그인 실패마다 스택이 쌓인다.
      ...(cause === undefined && status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? { stack: exception.stack }
        : {}),
    };
    const message = `${exception.code} -> ${status}: ${exception.message}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(payload, message);
      return;
    }

    if (AUTHZ_DENIAL_CODES.has(exception.code)) {
      this.logger.warn(payload, message);
      return;
    }

    this.logger.debug(payload, message);
  }
}
