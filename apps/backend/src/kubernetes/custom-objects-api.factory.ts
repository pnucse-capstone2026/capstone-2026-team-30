import * as http from "node:http";
import * as https from "node:https";
import {
  CustomObjectsApi,
  KubeConfig,
  RequestContext,
  ResponseContext,
} from "@kubernetes/client-node";
import { Observable, of } from "rxjs";

/**
 * 리컨실 배치는 후보를 순차로 처리하므로, 응답하지 않는 클러스터로 향한 호출 하나가
 * 뒤의 모든 클러스터 작업을 붙잡는다. `node-fetch` 로 바뀐 전송 계층에는 기본
 * 타임아웃이 없고 `makeApiClient` 는 설정을 받지 않으므로, 생성된 클라이언트의 모든
 * 호출에 `AbortSignal` 을 거는 미들웨어를 2번째 인자로 끼워 넣는다.
 *
 * Proxy 로 감싸는 이유는 이 관심사를 어댑터 밖에 두기 위해서다. 호출부(`KyvernoAdapter`)
 * 는 전송 계층 설정을 몰라야 하고, 호출이 늘어도 타임아웃이 자동으로 따라붙는다.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * EKS Control Plane 통신 시 TLS 핸드셰이크 오버헤드와 CoreDNS 쿼리 부하를 줄이기 위한
 * 전역 HTTP/HTTPS Keep-Alive 커넥션 풀 에이전트
 */
export const sharedHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60_000,
});

export const sharedHttpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60_000,
});

export function createCustomObjectsApi(
  kubeConfig: KubeConfig,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): CustomObjectsApi {
  const api = kubeConfig.makeApiClient(CustomObjectsApi);
  const options = {
    // 인증은 `authMethods` 로 따로 실려 미들웨어를 덮어써도 안전하지만, 기본 전략이
    // replace 라 다른 미들웨어가 생겼을 때 조용히 사라지지 않도록 명시한다.
    middlewareMergeStrategy: "append" as const,
    middleware: [
      {
        pre: (context: RequestContext): Observable<RequestContext> => {
          context.setSignal(AbortSignal.timeout(timeoutMs));
          const url = context.getUrl();
          if (url.startsWith("https:")) {
            context.setAgent(sharedHttpsAgent);
          } else if (url.startsWith("http:")) {
            context.setAgent(sharedHttpAgent);
          }
          return of(context);
        },
        post: (context: ResponseContext): Observable<ResponseContext> =>
          of(context),
      },
    ],
  };

  return new Proxy(api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      // 생성된 API 의 메서드는 전부 `(param, options?)` 형태다. 심볼 프로퍼티나
      // 값 프로퍼티는 손대지 않는다.
      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }
      return (param: unknown) =>
        (value as (param: unknown, options: unknown) => unknown).call(
          target,
          param,
          options,
        );
    },
  });
}

/**
 * 설정값이 없거나 숫자가 아니면 기본값으로 떨어진다. 0 이나 음수는 "타임아웃 없음"으로
 * 해석될 수 있어 받지 않는다.
 */
export function resolveRequestTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REQUEST_TIMEOUT_MS;
}
