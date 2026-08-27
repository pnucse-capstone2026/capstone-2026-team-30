export type UserRole = "ADMIN" | "APPROVER" | "REQUESTER" | "VIEWER";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  clusterIds: string[];
};

export type AuthResponse = {
  accessToken: string;
  user: AuthUser;
};

export type ApiErrorBody = {
  statusCode?: number;
  error?: string;
  code?: string;
  message?: string | string[];
};

export class ApiError extends Error {
  statusCode?: number;
  error?: string;
  code?: string;

  constructor(message: string, body: ApiErrorBody = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = body.statusCode;
    this.error = body.error;
    this.code = body.code;
  }
}

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== "undefined"
    ? `${window.location.origin}/api`
    : "http://localhost:3001");

export async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  let message = "요청을 처리하지 못했습니다.";
  let errorBody: ApiErrorBody = { statusCode: response.status };

  try {
    const body = (await response.json()) as ApiErrorBody;
    errorBody = { ...body, statusCode: body.statusCode ?? response.status };

    if (Array.isArray(body.message)) {
      message = body.message.join("\n");
    } else if (body.message) {
      message = body.message;
    }
  } catch {
    if (response.status === 401) {
      message = "이메일 또는 비밀번호를 확인해주세요.";
    }
  }

  throw new ApiError(message, errorBody);
}

export async function login(email: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });

  return parseResponse<AuthResponse>(response);
}

export async function refresh() {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });

  return parseResponse<AuthResponse>(response);
}

export async function logout() {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });

  return parseResponse<{ success: true }>(response);
}

export async function getMe(accessToken: string) {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "include",
  });

  return parseResponse<AuthUser>(response);
}
