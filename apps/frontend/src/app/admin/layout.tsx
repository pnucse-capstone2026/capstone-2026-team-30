"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ProtectedRoute requiredRoles={["ADMIN", "APPROVER"]}>
      {children}
    </ProtectedRoute>
  );
}
