import { API_BASE_URL, parseResponse, type UserRole } from "@/lib/auth-api";
import { useAuthStore } from "@/lib/auth-store";

export type ManagedUser = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
};

async function requestWithAuth<T>(path: string, options: RequestOptions = {}) {
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

export function listUsers() {
  return requestWithAuth<ManagedUser[]>("/users");
}

export function createUser(data: {
  email: string;
  password: string;
  role: UserRole;
}) {
  return requestWithAuth<ManagedUser>("/users", {
    method: "POST",
    body: data,
  });
}

export function updateUserRole(id: string, role: UserRole) {
  return requestWithAuth<ManagedUser>(`/users/${id}/role`, {
    method: "PATCH",
    body: { role },
  });
}

export function resetUserPassword(id: string, password: string) {
  return requestWithAuth<ManagedUser>(`/users/${id}/password`, {
    method: "PATCH",
    body: { password },
  });
}

export function setUserDisabled(id: string, disabled: boolean) {
  return requestWithAuth<ManagedUser>(`/users/${id}/disabled`, {
    method: "PATCH",
    body: { disabled },
  });
}
