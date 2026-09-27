import { API_BASE_URL, parseResponse } from "@/lib/auth-api";
import { useAuthStore } from "@/lib/auth-store";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

export async function requestWithAuth<T>(
  path: string,
  options: RequestOptions = {},
) {
  const { accessToken, refreshSession } = useAuthStore.getState();
  let token = accessToken;

  if (!token) {
    const user = await refreshSession();
    token = user ? useAuthStore.getState().accessToken : null;
  }

  if (!token) {
    throw new Error("로그인이 필요합니다.");
  }

  const makeRequest = (currentToken: string) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${currentToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "include",
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
    });

  let response = await makeRequest(token);

  if (response.status === 401) {
    const clone = response.clone();
    try {
      const errorData = await clone.json();
      if (errorData?.code === "AUTH_SESSION_EXPIRED") {
        await useAuthStore.getState().logout();
        throw new Error(
          errorData.message ||
            "다른 환경에서 로그인되어 세션이 만료되었습니다. 다시 로그인해 주세요.",
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("다른 환경에서 로그인")) {
        throw e;
      }
    }

    const user = await refreshSession();
    const refreshedToken = user ? useAuthStore.getState().accessToken : null;

    if (refreshedToken) {
      response = await makeRequest(refreshedToken);
    }
  }

  return parseResponse<T>(response);
}
