"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";

export default function MeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
