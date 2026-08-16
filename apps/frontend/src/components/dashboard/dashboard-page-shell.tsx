"use client";

import { Bell, Menu } from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";

type DashboardPageShellProps = {
  variant?: "user" | "admin";
  activeHref?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export function DashboardPageShell({
  variant = "user",
  activeHref,
  title,
  description,
  actions,
  children,
}: DashboardPageShellProps) {
  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant={variant} activeHref={activeHref} />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-20 items-center border-b border-slate-200 bg-white/95 px-5 backdrop-blur-sm sm:px-8">
          <button
            type="button"
            className="mr-3 flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
            aria-label="메뉴 열기"
          >
            <Menu className="size-5" />
          </button>
          <div>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              {title}
            </h1>
            {description ? (
              <p className="hidden text-xs text-slate-500 sm:block">
                {description}
              </p>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button
              type="button"
              className="relative flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              aria-label="알림 보기"
            >
              <Bell className="size-4.5" />
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-rose-500" />
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 p-5 sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
