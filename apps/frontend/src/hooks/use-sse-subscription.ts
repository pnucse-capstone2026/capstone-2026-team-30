import { useEffect, useRef } from "react";
import { API_BASE_URL } from "@/lib/auth-api";
import { useAuthStore } from "@/lib/auth-store";

export interface SseSubscriptionOptions<T = unknown> {
  /** SSE 엔드포인트 상대 경로 (예: '/mlops/pipelines/events') */
  path: string;
  /** 쿼리 스트링으로 전달할 객체 (clusterId, namespace 등) */
  queryParams?: Record<string, string | number | boolean | undefined | null>;
  /** 구독할 SSE 이벤트 명칭 목록 (미지정 시 기본 'message' 이벤트 수신) */
  events?: string[];
  /** SSE 메시지 수신 시 처리할 콜백 함수 */
  onMessage?: (data: T, eventType: string, rawEvent: MessageEvent) => void;
  /** SSE 연결 또는 수신 에러 발생 시 처리할 콜백 함수 */
  onError?: (error: Event) => void;
  /** SSE 연결 성공 시 콜백 함수 */
  onOpen?: () => void;
  /** 훅 동작 및 SSE 구독 활성화 여부 */
  enabled?: boolean;
}

/**
 * MLOps 및 플랫폼 모듈 공통 SSE(Server-Sent Events) 실시간 데이터 구독 훅입니다.
 * JWT 토큰 인가, 쿼리 파라미터 자동 생성 및 컴포넌트 언마운트 시 자동 cleanup을 처리합니다.
 *
 * @template T SSE 이벤트 데이터의 페이로드 타입
 * @param options SSE 구독 옵션 (path, queryParams, events, onMessage, enabled 등)
 */
export function useSseSubscription<T = unknown>(
  options: SseSubscriptionOptions<T>,
): void {
  const {
    path,
    queryParams,
    events,
    onMessage,
    onError,
    onOpen,
    enabled = true,
  } = options;

  const accessToken = useAuthStore((state) => state.accessToken);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onErrorRef.current = onError;
    onOpenRef.current = onOpen;
  }, [onMessage, onError, onOpen]);

  const serializedQueryParams = JSON.stringify(queryParams ?? {});
  const serializedEvents = JSON.stringify(events ?? []);

  useEffect(() => {
    if (!enabled || !accessToken || !path) {
      return;
    }

    const query = new URLSearchParams();
    const params: Record<string, unknown> = JSON.parse(serializedQueryParams);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query.append(key, String(value));
      }
    });

    // EventSource는 HTTP 헤더 조작이 불가능하므로 query parameter로 토큰을 전달함
    query.append("token", accessToken);

    const fullUrl = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}?${query.toString()}`;
    const eventSource = new EventSource(fullUrl);

    eventSource.onopen = () => {
      onOpenRef.current?.();
    };

    eventSource.onerror = (error) => {
      onErrorRef.current?.(error);
    };

    const targetEvents = JSON.parse(serializedEvents) as string[];
    const eventTypesToSubscribe =
      targetEvents.length > 0 ? targetEvents : ["message"];

    const listeners: Array<{
      type: string;
      handler: (e: MessageEvent) => void;
    }> = [];

    eventTypesToSubscribe.forEach((eventType) => {
      const handler = (event: MessageEvent) => {
        let parsedData: T = event.data as unknown as T;
        try {
          if (typeof event.data === "string") {
            parsedData = JSON.parse(event.data);
          }
        } catch {
          // JSON 파싱 실패 시 원본 문자열 전달
        }

        onMessageRef.current?.(parsedData, eventType, event);
      };

      eventSource.addEventListener(eventType, handler as EventListener);
      listeners.push({ type: eventType, handler });
    });

    return () => {
      listeners.forEach(({ type, handler }) => {
        eventSource.removeEventListener(type, handler as EventListener);
      });
      eventSource.close();
    };
  }, [path, enabled, accessToken, serializedQueryParams, serializedEvents]);
}
