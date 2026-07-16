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
        error instanceof Error
          ? error.message
          : "\ub85c\uadf8\uc778\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.";
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
    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = (async () => {
      const { accessToken, user } = get();

      if (accessToken && user) {
        try {
          const currentUser = await getMe(accessToken);
          set({ user: currentUser, status: "authenticated", error: null });
          return currentUser;
        } catch {
          return get().refreshSession();
        }
      }

      return get().refreshSession();
    })().finally(() => {
      initializePromise = null;
    });

    return initializePromise;
  },

  async refreshSession() {
    set({ status: "loading", error: null });

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
