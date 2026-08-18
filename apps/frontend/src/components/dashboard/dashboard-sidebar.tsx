"use client";

import Link from "next/link";
import {
  BellRing,
  Coins,
  FileClock,
  FilePlus2,
  Files,
  History,
  FileWarning,
  Layers,
  LayoutDashboard,
  Server,
  Settings,
  ShieldCheck,
  type LucideIcon,
  Users,
} from "lucide-react";

import { LogoutButton } from "@/components/auth/logout-button";
import { useAuthStore } from "@/lib/auth-store";

type DashboardSidebarProps = {
  variant?: "user" | "admin";
  activeHref?: string;
};

type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const navigation: Record<"user" | "admin", NavigationItem[]> = {
  user: [
    { label: "대시보드", href: "/dashboard", icon: LayoutDashboard },
    { label: "MLOps 노트북", href: "/mlops/notebooks", icon: Layers },
    { label: "MLOps 거버넌스", href: "/mlops/governance", icon: Coins },
    { label: "클러스터", href: "/clusters", icon: Server },
    { label: "정책", href: "/policies", icon: ShieldCheck },
    { label: "내 리소스 위반", href: "/violations", icon: FileWarning },
    { label: "예외 요청 목록", href: "/exceptions", icon: Files },
    { label: "예외 요청", href: "/exceptions/new", icon: FilePlus2 },
    { label: "알림", href: "/notifications", icon: BellRing },
  ],
  admin: [
    {
      label: "관리자 대시보드",
      href: "/admin/dashboard",
      icon: LayoutDashboard,
    },
    { label: "MLOps 노트북 관리", href: "/mlops/notebooks", icon: Layers },
    { label: "MLOps 거버넌스", href: "/mlops/governance", icon: Coins },
    { label: "클러스터 관리", href: "/admin/clusters", icon: Server },
    { label: "정책 관리", href: "/admin/policies", icon: ShieldCheck },
    { label: "사용자 관리", href: "/admin/users", icon: Users },
    { label: "정책 위반", href: "/admin/violations", icon: FileWarning },
    { label: "예외 관리", href: "/admin/exceptions", icon: FileClock },
    { label: "감사 로그", href: "/admin/audit-logs", icon: History },
    { label: "알림", href: "/notifications", icon: BellRing },
  ],
};

const fallbackProfile = {
  user: {
    initial: "사",
    name: "사용자",
    description: "정책 사용자",
  },
  admin: {
    initial: "관",
    name: "관리자",
    description: "시스템 운영자",
  },
};

export function DashboardSidebar({
  variant = "user",
  activeHref,
}: DashboardSidebarProps) {
  const user = useAuthStore((state) => state.user);
  const items = navigation[variant].filter(
    (item) => user?.role === "ADMIN" || item.href !== "/admin/users",
  );
  const currentHref =
    activeHref ?? (variant === "admin" ? "/admin/dashboard" : "/dashboard");
  const profileActive = currentHref === "/me";
  const profile = user
    ? {
        initial: user.email.slice(0, 1).toUpperCase(),
        name: user.email,
        description: user.role,
      }
    : fallbackProfile[variant];

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-800 bg-[#081b33] text-white lg:flex">
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
        <div className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/10">
          <ShieldCheck className="size-5 text-cyan-300" />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">Kyverno</p>
          <p className="text-[11px] text-slate-400">Governance Platform</p>
        </div>
      </div>

      <nav
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-6"
        aria-label="주요 메뉴"
      >
        <p className="mb-3 px-3 text-[10px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
          Workspace
        </p>
        {items.map(({ label, href, icon: Icon }) => {
          const active = href === currentHref;

          return (
            <Link
              key={label}
              href={href}
              className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
                active
                  ? "bg-blue-500/15 font-medium text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon
                className={`size-4.5 ${active ? "text-cyan-300" : ""}`}
                aria-hidden="true"
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-white/10 p-3">
        <Link
          href="/me"
          className={`flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
            profileActive
              ? "bg-blue-500/15 font-medium text-white"
              : "text-slate-400 hover:bg-white/5 hover:text-white"
          }`}
        >
          <Settings
            className={`size-4.5 ${profileActive ? "text-cyan-300" : ""}`}
          />
          내 정보
        </Link>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-white/[0.05] p-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-cyan-300 text-xs font-bold text-[#081b33]">
            {profile.initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{profile.name}</p>
            <p className="truncate text-[10px] text-slate-400">
              {profile.description}
            </p>
          </div>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
