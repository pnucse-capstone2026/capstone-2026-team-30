"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";

export default function AdminUsersLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ProtectedRoute requiredRole="ADMIN">{children}</ProtectedRoute>;
}
