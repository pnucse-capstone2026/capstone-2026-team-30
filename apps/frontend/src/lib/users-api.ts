import { requestWithAuth } from "@/lib/api-client";
import { type UserRole } from "@/lib/auth-api";

export type ManagedUser = {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

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
