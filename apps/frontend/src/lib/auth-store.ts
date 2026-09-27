"use client";

import { create } from "zustand";

import {
  type AuthUser,
  getMe,
  login as loginRequest,
  logout as logoutRequest,
  refresh as refreshRequest,
} from "@/lib/auth-api";

type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  initialize: () => Promise<AuthUser | null>;
  refreshSession: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  clearError: () => void;
};

const AUTH_SYNC_CHANNEL_NAME = "kyverno_auth_sync";
const AUTH_STORAGE_KEY = "kyverno_auth_active";

type AuthBroadcastMessage =
  | { type: "LOGIN"; user: AuthUser; accessToken: string }
  | { type: "LOGOUT" }
  | { type: "TOKEN_REFRESH"; user: AuthUser; accessToken: string }
  | { type: "REQUEST_AUTH_STATE" }
  | { type: "AUTH_STATE_RESPONSE"; user: AuthUser; accessToken: string };

let authChannel: BroadcastChannel | null = null;

/**
 * 탭 간 인증 상태 동기화를 위한 브라우저 BroadcastChannel 인스턴스를 반환합니다.
 *
 * @returns {BroadcastChannel | null} BroadcastChannel 인스턴스 또는 지원되지 않는 환경일 경우 null
 */
function getAuthChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
    return null;
  }
  if (!authChannel) {
    authChannel = new BroadcastChannel(AUTH_SYNC_CHANNEL_NAME);
  }
  return authChannel;
}

/**
 * 동일 브라우저 내 다른 탭으로 인증 관련 메시지를 전파합니다.
 *
 * @param {AuthBroadcastMessage} message 전송할 인증 메시지 객체
 */
function broadcastAuthMessage(message: AuthBroadcastMessage): void {
  try {
    getAuthChannel()?.postMessage(message);
  } catch {
    // 채널 전파 실패 시 개별 탭 런타임에 영향을 주지 않도록 무시
  }
}

/**
 * 활성 세션 존재 여부를 localStorage 플래그에 기록하거나 삭제합니다.
 *
 * @param {boolean} active 활성 상태 여부
 */
function setSessionActiveFlag(active: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (active) {
      localStorage.setItem(AUTH_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // 프라이빗 브라우징 등 스토리지 접근 차단 환경 예외 방지
  }
}

let initializePromise: Promise<AuthUser | null> | null = null;
let refreshPromise: Promise<AuthUser | null> | null = null;
let channelListenerInitialized = false;

/**
 * 다른 탭으로부터의 인증 상태 변경 메시지를 수신하여 로컬 스토어에 동기화합니다.
 *
 * @param {(state: Partial<AuthState>) => void} set Zustand set 함수
 * @param {() => AuthState} get Zustand get 함수
 */
function initAuthChannelListener(
  set: (state: Partial<AuthState>) => void,
  get: () => AuthState,
): void {
  if (channelListenerInitialized) return;
  const channel = getAuthChannel();
  if (!channel) return;

  channelListenerInitialized = true;
  channel.addEventListener(
    "message",
    (event: MessageEvent<AuthBroadcastMessage>) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      switch (data.type) {
        case "LOGIN":
        case "TOKEN_REFRESH":
        case "AUTH_STATE_RESPONSE":
          set({
            accessToken: data.accessToken,
            user: data.user,
            status: "authenticated",
            error: null,
          });
          setSessionActiveFlag(true);
          break;

        case "LOGOUT":
          set({
            accessToken: null,
            user: null,
            status: "unauthenticated",
            error: null,
          });
          setSessionActiveFlag(false);
          break;

        case "REQUEST_AUTH_STATE": {
          const { accessToken, user, status } = get();
          if (status === "authenticated" && accessToken && user) {
            broadcastAuthMessage({
              type: "AUTH_STATE_RESPONSE",
              user,
              accessToken,
            });
          }
          break;
        }
      }
    },
  );
}

export const useAuthStore = create<AuthState>((set, get) => {
  if (typeof window !== "undefined") {
    initAuthChannelListener(set, get);
  }

  return {
    accessToken: null,
    user: null,
    status: "idle",
    error: null,

    async login(email, password) {
      set({ status: "loading", error: null });

      try {
        const result = await loginRequest(email, password);
        set({
          accessToken: result.accessToken,
          user: result.user,
          status: "authenticated",
          error: null,
        });
        setSessionActiveFlag(true);
        broadcastAuthMessage({
          type: "LOGIN",
          user: result.user,
          accessToken: result.accessToken,
        });
        return result.user;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "로그인에 실패했습니다.";
        set({
          accessToken: null,
          user: null,
          status: "unauthenticated",
          error: message,
        });
        throw error;
      }
    },

    async initialize() {
      const { accessToken, user, status } = get();

      // 이미 메모리에 인증 토큰과 유저 정보가 존재하는 경우 즉시 반환
      if (status === "authenticated" && accessToken && user) {
        return user;
      }

      if (initializePromise) {
        return initializePromise;
      }

      initializePromise = (async () => {
        const currentState = get();

        if (currentState.accessToken && currentState.user) {
          return currentState.user;
        }

        // 1. 이미 활성화된 다른 탭이 있다면 브로드캐스트 채널로 즉시 인증 상태 복사 (중복 API 요청 및 RTR 충돌 방지)
        let hasActiveSession = false;
        if (typeof window !== "undefined") {
          try {
            hasActiveSession = localStorage.getItem(AUTH_STORAGE_KEY) === "1";
          } catch {
            // ignore
          }
        }

        if (
          hasActiveSession &&
          typeof window !== "undefined" &&
          "BroadcastChannel" in window
        ) {
          const peerUser = await new Promise<AuthUser | null>((resolve) => {
            let timer: NodeJS.Timeout | null = null;
            const channel = getAuthChannel();
            if (!channel) {
              resolve(null);
              return;
            }

            const handler = (event: MessageEvent<AuthBroadcastMessage>) => {
              if (event.data?.type === "AUTH_STATE_RESPONSE") {
                if (timer) clearTimeout(timer);
                channel.removeEventListener("message", handler);
                resolve(event.data.user);
              }
            };

            channel.addEventListener("message", handler);
            broadcastAuthMessage({ type: "REQUEST_AUTH_STATE" });

            // 150ms 내 다른 탭 응답이 없으면 단독 탭으로 간주하고 refreshSession()으로 진행
            timer = setTimeout(() => {
              channel.removeEventListener("message", handler);
              resolve(null);
            }, 150);
          });

          if (peerUser) {
            return peerUser;
          }
        }

        return get().refreshSession();
      })().finally(() => {
        initializePromise = null;
      });

      return initializePromise;
    },

    async refreshSession() {
      if (refreshPromise) {
        return refreshPromise;
      }

      const { status } = get();

      // 상태가 이미 인증된 상태라면 로딩 상태 플리커링 방지
      if (status !== "authenticated") {
        set({ status: "loading", error: null });
      }

      refreshPromise = (async () => {
        try {
          const result = await refreshRequest();
          set({
            accessToken: result.accessToken,
            user: result.user,
            status: "authenticated",
            error: null,
          });
          setSessionActiveFlag(true);
          broadcastAuthMessage({
            type: "TOKEN_REFRESH",
            user: result.user,
            accessToken: result.accessToken,
          });
          return result.user;
        } catch {
          set({
            accessToken: null,
            user: null,
            status: "unauthenticated",
          });
          setSessionActiveFlag(false);
          return null;
        }
      })().finally(() => {
        refreshPromise = null;
      });

      return refreshPromise;
    },

    async logout() {
      try {
        await logoutRequest();
      } finally {
        set({
          accessToken: null,
          user: null,
          status: "unauthenticated",
          error: null,
        });
        setSessionActiveFlag(false);
        broadcastAuthMessage({ type: "LOGOUT" });
      }
    },

    clearError() {
      set({ error: null });
    },
  };
});
