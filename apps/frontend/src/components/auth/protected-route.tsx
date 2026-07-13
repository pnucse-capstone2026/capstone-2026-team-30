"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

import { type UserRole } from "@/lib/auth-api";
import { useAuthStore } from "@/lib/auth-store";

type ProtectedRouteProps = {
  children: React.ReactNode;
  requiredRole?: UserRole;
  requiredRoles?: UserRole[];
};

export function ProtectedRoute({
  children,
  requiredRole,
  requiredRoles,
}: ProtectedRouteProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { initialize, status, user } = useAuthStore();
  const allowedRoles = useMemo(
    () => requiredRoles ?? (requiredRole ? [requiredRole] : undefined),
    [requiredRole, requiredRoles],
  );
  const fallbackPath =
    pathname.startsWith("/admin") && user?.role === "APPROVER"
      ? "/admin/exceptions"
      : "/dashboard";

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (
      status === "authenticated" &&
      allowedRoles &&
      (!user || !allowedRoles.includes(user.role))
    ) {
      router.replace(fallbackPath);
    }
  }, [allowedRoles, fallbackPath, pathname, router, status, user]);

  if (status === "idle" || status === "loading") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f4f7fb] text-sm text-slate-500">
        {"\ub85c\uadf8\uc778 \uc0c1\ud0dc \ud655\uc778 \uc911"}
      </main>
    );
  }

  if (status !== "authenticated") {
    return null;
  }

  if (allowedRoles && (!user || !allowedRoles.includes(user.role))) {
    return null;
  }

  return <>{children}</>;
}
