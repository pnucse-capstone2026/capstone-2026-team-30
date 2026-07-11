"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { type UserRole } from "@/lib/auth-api";
import { useAuthStore } from "@/lib/auth-store";

type ProtectedRouteProps = {
  children: React.ReactNode;
  requiredRole?: UserRole;
};

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { initialize, status, user } = useAuthStore();

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
      requiredRole &&
      user?.role !== requiredRole
    ) {
      router.replace("/dashboard");
    }
  }, [pathname, requiredRole, router, status, user]);

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

  if (requiredRole && user?.role !== requiredRole) {
    return null;
  }

  return <>{children}</>;
}
