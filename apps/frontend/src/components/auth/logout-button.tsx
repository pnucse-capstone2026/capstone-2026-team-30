"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { useAuthStore } from "@/lib/auth-store";

export function LogoutButton() {
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);

  async function handleLogout() {
    await logout();
    router.replace("/");
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      aria-label="로그아웃"
      className="text-slate-500 hover:text-white"
    >
      <LogOut className="size-4" />
    </button>
  );
}
