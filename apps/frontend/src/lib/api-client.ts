import { API_BASE_URL, parseResponse } from "@/lib/auth-api";
import { useAuthStore } from "@/lib/auth-store";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

  let response = await makeRequest(token);

  if (response.status === 401) {
    const user = await refreshSession();
    const refreshedToken = user ? useAuthStore.getState().accessToken : null;

    if (refreshedToken) {
      response = await makeRequest(refreshedToken);
    }
  }

  return parseResponse<T>(response);
}
