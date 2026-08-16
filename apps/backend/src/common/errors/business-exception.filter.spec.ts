import { ApiException } from "@kubernetes/client-node";
import {
  ArgumentsHost,
  ConsoleLogger,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Logger as PinoNestLogger, PinoLogger } from "nestjs-pino";
import { AUTH_ERROR } from "../../auth/auth.errors";
import { EXCEPTION_LIFECYCLE_ERROR } from "../../exception-lifecycle/exception-lifecycle.errors";
import { EXCEPTION_REQUEST_ERROR } from "../../exception-requests/exception-request.errors";
import { USER_ERROR } from "../../users/user.errors";
import { BUSINESS_ERRORS } from "./business-error-catalog";
import {
  BUSINESS_ERROR_HTTP_STATUS,
  BusinessExceptionFilter,
} from "./business-exception.filter";
import { BusinessException, isBusinessException } from "./business.exception";

function createFilter() {
  const reply = jest.fn();
  const response = {};
  const adapterHost = {
    httpAdapter: { reply },
  } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: jest.fn().mockReturnValue({
      getResponse: jest.fn().mockReturnValue(response),
    }),
  } as unknown as ArgumentsHost;

  return {
    filter: new BusinessExceptionFilter(adapterHost),
    host,
    reply,
    response,
    logError: jest.spyOn(Logger.prototype, "error").mockImplementation(),
    logWarn: jest.spyOn(Logger.prototype, "warn").mockImplementation(),
    logDebug: jest.spyOn(Logger.prototype, "debug").mockImplementation(),
  };
}

describe("BusinessExceptionFilter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("registers unique business error codes with an HTTP status", () => {
    const codes = BUSINESS_ERRORS.map((error) => error.code);

    expect(new Set(codes).size).toBe(codes.length);
    expect(Object.keys(BUSINESS_ERROR_HTTP_STATUS).sort()).toEqual(
      [...codes].sort(),
    );
  });

  it.each([
    [EXCEPTION_REQUEST_ERROR.EXPIRED, HttpStatus.BAD_REQUEST, "Bad Request"],
    [AUTH_ERROR.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, "Unauthorized"],
    [AUTH_ERROR.INSUFFICIENT_PERMISSIONS, HttpStatus.FORBIDDEN, "Forbidden"],
    [USER_ERROR.NOT_FOUND, HttpStatus.NOT_FOUND, "Not Found"],
    [
      EXCEPTION_LIFECYCLE_ERROR.INVALID_TRANSITION,
      HttpStatus.CONFLICT,
      "Conflict",
    ],
    [
      EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE,
      HttpStatus.BAD_GATEWAY,
      "Bad Gateway",
    ],
  ])(
    "serializes $code without exposing internal diagnostics",
    (error, status, errorName) => {
      const context = createFilter();
      const exception = new BusinessException(error, {
        message: "Public message.",
        cause: new Error("private cause"),
        context: { requestId: "private-request-id" },
      });

      context.filter.catch(exception, context.host);

      expect(context.reply).toHaveBeenCalledWith(
        context.response,
        {
          statusCode: status,
          error: errorName,
          code: error.code,
          message: "Public message.",
        },
        status,
      );
    },
  );

  it("logs a 5xx with the summarized cause", () => {
    const context = createFilter();
    const cause = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.1:6443"),
      {
        code: "ECONNREFUSED",
        errno: -111,
        syscall: "connect",
      },
    );
    const exception = new BusinessException(
      EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE,
      { cause, context: { requestId: "request-1" } },
    );

    context.filter.catch(exception, context.host);

    expect(context.logError).toHaveBeenCalledWith(
      {
        code: EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE.code,
        statusCode: HttpStatus.BAD_GATEWAY,
        errorContext: { requestId: "request-1" },
        cause: {
          type: "Error",
          message: cause.message,
          stack: expect.stringContaining("at "),
          code: "ECONNREFUSED",
          errno: -111,
          syscall: "connect",
        },
      },
      `${EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE.code} -> 502: Unable to validate the Kyverno policy.`,
    );
    expect(context.logDebug).not.toHaveBeenCalled();
  });

  it("omits the cause entirely for a 4xx that has none", () => {
    const context = createFilter();

    context.filter.catch(
      new BusinessException(AUTH_ERROR.INVALID_CREDENTIALS),
      context.host,
    );

    expect(context.logError).not.toHaveBeenCalled();
    expect(context.logDebug).toHaveBeenCalledWith(
      {
        code: AUTH_ERROR.INVALID_CREDENTIALS.code,
        statusCode: HttpStatus.UNAUTHORIZED,
        errorContext: undefined,
        cause: undefined,
      },
      `${AUTH_ERROR.INVALID_CREDENTIALS.code} -> 401: Invalid credentials.`,
    );
  });

  it("falls back to its own stack for a 5xx with no cause", () => {
    const context = createFilter();
    const exception = new BusinessException(
      EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE,
    );

    context.filter.catch(exception, context.host);

    expect(context.logError).toHaveBeenCalledWith(
      expect.objectContaining({ cause: undefined, stack: exception.stack }),
      expect.any(String),
    );
  });

  it("reduces a non-Error cause to a string instead of leaking the object", () => {
    const context = createFilter();

    context.filter.catch(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause: { token: "secret-bearer-token" },
      }),
      context.host,
    );

    const [payload] = context.logError.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(typeof payload.cause).toBe("string");
    expect(JSON.stringify(payload)).not.toContain("secret-bearer-token");
  });

  it("never throws out of catch when the cause resists inspection", () => {
    const context = createFilter();
    const cause = Object.create(null) as object;

    expect(() =>
      context.filter.catch(
        new BusinessException(
          EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE,
          { cause },
        ),
        context.host,
      ),
    ).not.toThrow();
    expect(context.reply).toHaveBeenCalledTimes(1);
    expect(context.logError).toHaveBeenCalledTimes(1);
  });

  it.each([
    [AUTH_ERROR.INSUFFICIENT_PERMISSIONS],
    [EXCEPTION_REQUEST_ERROR.SELF_DECISION_FORBIDDEN],
  ])("raises $code to warn so it survives the production level", (error) => {
    const context = createFilter();

    context.filter.catch(new BusinessException(error), context.host);

    expect(context.logWarn).toHaveBeenCalledTimes(1);
    expect(context.logDebug).not.toHaveBeenCalled();
    expect(context.logError).not.toHaveBeenCalled();
  });

  it("logs before replying so a failing reply cannot lose the record", () => {
    const context = createFilter();
    context.reply.mockImplementation(() => {
      throw new Error("response already sent");
    });

    expect(() =>
      context.filter.catch(
        new BusinessException(
          EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE,
        ),
        context.host,
      ),
    ).toThrow("response already sent");
    expect(context.logError).toHaveBeenCalledTimes(1);
  });

  it("keeps the cause out of the response body while logging it", () => {
    const context = createFilter();
    const exception = new BusinessException(
      EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE,
      { cause: new Error("private cause"), context: { secret: "do-not-leak" } },
    );

    context.filter.catch(exception, context.host);

    const [, body] = context.reply.mock.calls[0];
    expect(JSON.stringify(body)).not.toContain("private cause");
    expect(JSON.stringify(body)).not.toContain("do-not-leak");
    expect(context.logError).toHaveBeenCalled();
  });

  it("identifies only the requested business error code", () => {
    const exception = new BusinessException(AUTH_ERROR.INVALID_REFRESH_TOKEN);

    expect(
      isBusinessException(exception, AUTH_ERROR.INVALID_REFRESH_TOKEN.code),
    ).toBe(true);
    expect(
      isBusinessException(exception, AUTH_ERROR.INVALID_CREDENTIALS.code),
    ).toBe(false);
    expect(isBusinessException(new Error("unexpected"))).toBe(false);
  });
});

/**
 * 위 테스트들은 `Logger.prototype` 을 스파이하므로 nestjs-pino 까지 도달하지
 * 않는다. 실제 결함은 그 경계에서 생긴다 — 페이로드 키가 로거 이름을 덮어쓰거나,
 * 두 번째 인자가 기대와 다르게 해석되거나, `cause` 가 직렬화되면서 정보를
 * 잃는 문제는 모두 프로토타입 스파이로는 보이지 않는다. 그래서 여기서는
 * PinoLogger 를 실제 스트림에 붙여 최종 JSON 을 검사한다.
 */
describe("BusinessExceptionFilter log output through nestjs-pino", () => {
  const lines: Record<string, unknown>[] = [];
  const pinoBackedLogger = new PinoNestLogger(
    new PinoLogger({
      pinoHttp: {
        level: "debug",
        stream: {
          write: (line: string) => {
            lines.push(JSON.parse(line));
          },
        },
      },
    }),
    {},
  );

  beforeAll(() => {
    Logger.overrideLogger(pinoBackedLogger);
  });

  afterAll(() => {
    // `overrideLogger(false)` 는 복구가 아니라 로깅을 전역으로 끈다
    // (logger.service.js 가 staticInstanceRef 를 undefined 로 만든다).
    // 이 뒤에 블록이 추가되면 로그가 조용히 사라지므로 기본 로거로 되돌린다.
    Logger.overrideLogger(new ConsoleLogger());
  });

  beforeEach(() => {
    lines.length = 0;
  });

  function catchThrough(exception: BusinessException) {
    const reply = jest.fn();
    const adapterHost = {
      httpAdapter: { reply },
    } as unknown as HttpAdapterHost;
    const host = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue({}),
      }),
    } as unknown as ArgumentsHost;

    new BusinessExceptionFilter(adapterHost).catch(exception, host);

    expect(lines).toHaveLength(1);
    return lines[0];
  }

  it("keeps the emitting class name in the pino context field", () => {
    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        context: { requestId: "request-1" },
      }),
    );

    // `context` 를 페이로드 키로 쓰면 이 값이 지워진다.
    expect(line.context).toBe("BusinessExceptionFilter");
    expect(line.errorContext).toEqual({ requestId: "request-1" });
  });

  it("emits a human-readable msg rather than a stack blob", () => {
    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause: new Error("connect ECONNREFUSED 10.0.0.1:6443"),
      }),
    );

    expect(line.msg).toBe(
      "POLICY_LOOKUP_UNAVAILABLE -> 502: Unable to validate the Kyverno policy.",
    );
  });

  it("keeps the real error class name instead of letting pino overwrite it", () => {
    const cause = Object.assign(new Error("HTTP request failed"), {
      name: "HttpError",
    });

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    // 이 요약을 `err` 키로 실으면 pino 가 오류로 간주해 type 을 생성자 이름
    // ("Object")으로 덮어쓴다. `cause` 키에는 기본 시리얼라이저가 없다.
    expect((line.cause as Record<string, unknown>).type).toBe("HttpError");
  });

  it("logs the reason but not the document snippet of a YAML parse failure", () => {
    // js-yaml 의 YAMLException 은 message 에 원본 문서 조각을 끼워 넣는다.
    // kubeconfig 를 읽다 실패하면 그 조각에 자격증명이 들어 있다.
    const cause = Object.assign(
      new Error(
        [
          "bad indentation of a mapping entry (11:21)",
          "",
          "  9 |   user:",
          " 10 |     token: SUPER-SECRET-SA-TOKEN",
          " 11 |      client-key-data: PRIVATE-KEY-MATERIAL",
          "--------------------------^",
        ].join("\n"),
      ),
      {
        name: "YAMLException",
        reason: "bad indentation of a mapping entry",
        mark: { line: 10, column: 20, snippet: "…" },
      },
    );

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain("SUPER-SECRET-SA-TOKEN");
    expect(serialized).not.toContain("PRIVATE-KEY-MATERIAL");
    expect((line.cause as Record<string, unknown>).message).toBe(
      "bad indentation of a mapping entry",
    );
  });

  it("never serializes the Kubernetes bearer token carried by an HttpError", () => {
    const token = "Bearer eyJhbGciOiJSUzI1NiJ9.SUPER-SECRET-SA-TOKEN.sig";
    // @kubernetes/client-node 의 HttpError 는 HTTP 응답 전체를 own enumerable
    // `response` 로 들고 있고, request 가 `response.request = self` 로 자신을
    // 매달면서 Authorization 헤더까지 따라온다. cause 를 pino 에 그대로 넘기면
    // err 시리얼라이저가 이 그래프를 전부 복사해 토큰이 로그로 나간다.
    const cause = Object.assign(new Error("HTTP request failed"), {
      name: "HttpError",
      statusCode: 403,
      body: { kind: "Status", code: 403, message: "forbidden" },
      response: {
        statusCode: 403,
        request: {
          method: "GET",
          href: "https://10.96.0.1/apis/kyverno.io/v1/clusterpolicies/p",
          headers: { Accept: "application/json", Authorization: token },
        },
      },
    });

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    expect(JSON.stringify(line)).not.toContain("SUPER-SECRET-SA-TOKEN");
    expect(line.cause).not.toHaveProperty("response");
    // 토큰을 막으면서 진단 정보는 유지해야 한다.
    expect((line.cause as Record<string, unknown>).statusCode).toBe(403);
  });

  it("preserves diagnostics that the cause message alone would drop", () => {
    // @kubernetes/client-node 의 HttpError 는 message 가 상수이고 실제 사유는
    // body/statusCode 에 있다. 그 모양을 그대로 재현한다.
    const cause = Object.assign(new Error("HTTP request failed"), {
      name: "HttpError",
      statusCode: 403,
      body: {
        kind: "Status",
        code: 403,
        message: "clusterpolicies.kyverno.io is forbidden",
      },
    });

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    const err = line.cause as Record<string, unknown>;
    expect(err.statusCode).toBe(403);
    expect(err.body).toMatchObject({
      message: "clusterpolicies.kyverno.io is forbidden",
    });
    expect(err.stack).toContain("at ");
    expect(err.stack).not.toContain("HTTP request failed");
    expect(line.level).toBe(50);
  });

  it("keeps the status of a real ApiException without logging its headers", () => {
    // 손으로 만든 HttpError 모양이 아니라 라이브러리의 진짜 예외로 확인한다.
    // ApiException 의 own enumerable 은 code/body/headers 뿐이고, 요약기가
    // 고르는 목록에 headers 가 없어야 한다.
    const cause = new ApiException(
      403,
      "Forbidden",
      {
        kind: "Status",
        code: 403,
        message: "clusterpolicies.kyverno.io is forbidden",
      },
      { authorization: "Bearer SUPER-SECRET-SA-TOKEN" },
    );

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    const err = line.cause as Record<string, unknown>;
    expect(err.code).toBe(403);
    expect(err.body).toMatchObject({
      message: "clusterpolicies.kyverno.io is forbidden",
    });
    expect(JSON.stringify(line)).not.toContain("SUPER-SECRET-SA-TOKEN");
  });

  it("redacts credential-plugin secrets from an untrusted error message", () => {
    const clientSecret = "credential-plugin-client-secret-value";
    const idToken = "eyJhbGciOiJSUzI1NiJ9.payload.signature";
    const unlabeledJwt = "eyJhbGciOiJSUzI1NiJ9.SUPER-SECRET-SA-TOKEN.signature";
    const whitespaceHeaderJwt =
      "IHsiYWxnIjoiUlMyNTYiLCJ0eXAiOiJKV1QifQ.eyJzdWIiOiJzZW5zaXRpdmUtdXNlciJ9.signature";
    const unsecuredJwt =
      "eyJhbGciOiJub25lIn0.eyJzdWIiOiJzZW5zaXRpdmUtdXNlciJ9.";
    const cause = new Error(
      [
        "credential plugin failed",
        `CLIENT-SECRET=${clientSecret}`,
        `LEAKED-ID-TOKEN=${idToken}`,
        `raw credential: ${unlabeledJwt}`,
        `whitespace header: ${whitespaceHeaderJwt}`,
        `unsecured: ${unsecuredJwt}`,
      ].join("\n"),
    );

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain(clientSecret);
    expect(serialized).not.toContain(idToken);
    expect(serialized).not.toContain(unlabeledJwt);
    expect(serialized).not.toContain(whitespaceHeaderJwt);
    expect(serialized).not.toContain(unsecuredJwt);
    expect((line.cause as Record<string, unknown>).message).toContain(
      "[REDACTED]",
    );
  });

  it("redacts secrets from custom stack frames after removing the header", () => {
    const token = "eyJhbGciOiJSUzI1NiJ9.STACK-SECRET.signature";
    const cause = new Error("credential plugin failed");
    cause.stack = [
      "Error: credential plugin failed",
      `    at Authorization Bearer ${token}`,
      "    at safeFrame (/workspace/app.js:2:1)",
    ].join("\n");

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    const summary = line.cause as Record<string, unknown>;
    expect(JSON.stringify(summary)).not.toContain(token);
    expect(summary.stack).toContain("Bearer [REDACTED]");
    expect(summary.stack).toContain("safeFrame");
  });

  it("caps long messages and never re-admits the original through the stack", () => {
    const secretSuffix = "SECRET-SUFFIX-ONLY-IN-THE-UNCAPPED-MESSAGE";
    const cause = new Error(`${"x".repeat(20_000)}${secretSuffix}`);

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    const summary = line.cause as Record<string, unknown>;
    expect(summary.message).toHaveLength(513);
    expect(summary.message).toContain("… (truncated)");
    expect(String(summary.stack).length).toBeLessThanOrEqual(4_013);
    expect(JSON.stringify(line)).not.toContain(secretSuffix);
  });

  it.each([
    [499, 499, false],
    [500, 500, false],
    [501, 513, true],
  ])(
    "keeps the message truncation boundary at %i characters",
    (inputLength, outputLength, truncated) => {
      const line = catchThrough(
        new BusinessException(
          EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE,
          { cause: new Error("x".repeat(inputLength)) },
        ),
      );

      const message = String((line.cause as Record<string, unknown>).message);
      expect(message).toHaveLength(outputLength);
      expect(message.includes("… (truncated)")).toBe(truncated);
    },
  );

  it("preserves other diagnostics when a body cannot be serialized", () => {
    const circularBody: Record<string, unknown> = { source: "proxy" };
    circularBody.self = circularBody;
    const cause = Object.assign(new Error("HTTP request failed"), {
      name: "HttpError",
      statusCode: 502,
      code: "EUPSTREAM",
      body: circularBody,
    });

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    expect(line.cause).toMatchObject({
      type: "HttpError",
      message: "HTTP request failed",
      code: "EUPSTREAM",
      statusCode: 502,
      body: "[unserializable body]",
    });
  });

  it("preserves other diagnostics when one cause field throws", () => {
    const cause = Object.assign(new Error("connect failed"), {
      code: "ECONNREFUSED",
      errno: -111,
      syscall: "connect",
    }) as Error & { cause?: unknown };
    Object.defineProperty(cause, "cause", {
      get() {
        throw new Error("cause getter exploded");
      },
    });

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    expect(line.cause).toMatchObject({
      type: "Error",
      message: "connect failed",
      code: "ECONNREFUSED",
      errno: -111,
      syscall: "connect",
      cause: "[unreadable cause]",
    });
  });

  it("does not execute serializer hooks from allowlisted diagnostic fields", () => {
    const leakedJwt = "eyJhbGciOiJSUzI1NiJ9.SERIALIZER-SECRET.signature";
    const cause = Object.assign(new Error("HTTP request failed"), {
      name: "HttpError",
      statusCode: 502,
      code: {
        toJSON() {
          throw new Error("serializer exploded");
        },
      },
      body: {
        kind: "Status",
        code: 502,
        reason: {
          toJSON() {
            return leakedJwt;
          },
        },
        message: "upstream failed",
      },
    });

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    expect(JSON.stringify(line)).not.toContain(leakedJwt);
    expect(line.cause).toMatchObject({
      type: "HttpError",
      message: "HTTP request failed",
      code: "[non-scalar]",
      statusCode: 502,
      body: {
        kind: "Status",
        code: 502,
        reason: "[non-scalar]",
        message: "upstream failed",
      },
    });
  });

  it("preserves nested causes up to the configured depth and terminates cycles", () => {
    const first = new Error("first") as Error & { cause?: unknown };
    const second = new Error("second") as Error & { cause?: unknown };
    first.cause = second;
    second.cause = first;

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause: first,
      }),
    );

    const levelOne = line.cause as Record<string, unknown>;
    const levelTwo = levelOne.cause as Record<string, unknown>;
    const levelThree = levelTwo.cause as Record<string, unknown>;
    expect(levelOne.message).toBe("first");
    expect(levelTwo.message).toBe("second");
    expect(levelThree.message).toBe("first");
    expect(levelThree).not.toHaveProperty("cause");
  });

  it("caps a non-Status response body without losing its marker", () => {
    const bodySuffix = "BODY-SUFFIX-ONLY-AFTER-THE-LIMIT";
    const cause = Object.assign(new Error("proxy failed"), {
      body: { payload: `${"x".repeat(3_000)}${bodySuffix}` },
    });

    const line = catchThrough(
      new BusinessException(EXCEPTION_REQUEST_ERROR.POLICY_LOOKUP_UNAVAILABLE, {
        cause,
      }),
    );

    const body = String((line.cause as Record<string, unknown>).body);
    expect(body).toHaveLength(2_013);
    expect(body).toContain("… (truncated)");
    expect(body).not.toContain(bodySuffix);
  });

  it("emits a 4xx at debug level", () => {
    const line = catchThrough(
      new BusinessException(AUTH_ERROR.INVALID_CREDENTIALS),
    );

    expect(line.level).toBe(20);
    expect(line.context).toBe("BusinessExceptionFilter");
  });
});
