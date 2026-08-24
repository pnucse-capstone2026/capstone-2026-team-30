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

let initializePromise: Promise<AuthUser | null> | null = null;
let refreshPromise: Promise<AuthUser | null> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
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

    // 이미 메모리에 인증 토큰과 유저 정보가 존재하는 경우 0ms 반환 (네트워크 중복 호출 방지)
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
        return result.user;
      } catch {
        set({
          accessToken: null,
          user: null,
          status: "unauthenticated",
        });
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
    }
  },

  clearError() {
    set({ error: null });
  },
}));
