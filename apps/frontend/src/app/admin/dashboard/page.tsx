import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  Menu,
  Search,
  Server,
  ShieldAlert,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";

const summaryCards = [
  {
    label: "\uc5f0\uacb0\ub41c \ud074\ub7ec\uc2a4\ud130",
    value: "4",
    detail: "\ubaa8\ub4e0 \ud074\ub7ec\uc2a4\ud130 \uc815\uc0c1",
    icon: Server,
    tone: "blue",
    trend: "+1",
  },
  {
    label: "\uc801\uc6a9 \uc911\uc778 \uc815\ucc45",
    value: "28",
    detail: "\uc9c0\ub09c\ub2ec \ub300\ube44 \uc99d\uac00",
    icon: FileCheck2,
    tone: "emerald",
    trend: "+12%",
  },
  {
    label: "\uc815\ucc45 \uc704\ubc18",
    value: "12",
    detail: "\uc9c0\ub09c\uc8fc \ub300\ube44 \uac10\uc18c",
    icon: ShieldAlert,
    tone: "amber",
    trend: "-8%",
  },
  {
    label: "\ud655\uc778 \ud544\uc694",
    value: "3",
    detail: "\uc2e0\uaddc \uc54c\ub9bc",
    icon: AlertTriangle,
    tone: "rose",
    trend: "+2",
  },
];

const violations = [
  {
    policy: "require-resource-limits",
    resource: "Deployment / payment-api",
    cluster: "production",
    severity: "\ub192\uc74c",
    time: "5\ubd84 \uc804",
  },
  {
    policy: "disallow-latest-tag",
    resource: "Pod / worker-7f86c",
    cluster: "staging",
    severity: "\uc911\uac04",
    time: "18\ubd84 \uc804",
  },
  {
    policy: "require-team-label",
    resource: "Service / user-service",
    cluster: "development",
    severity: "\ub0ae\uc74c",
    time: "42\ubd84 \uc804",
  },
];

const clusterStatus = [
  { name: "production", policies: 28, violations: 7, status: "\uc815\uc0c1" },
  { name: "staging", policies: 24, violations: 3, status: "\uc815\uc0c1" },
  { name: "development", policies: 18, violations: 2, status: "\uc815\uc0c1" },
  { name: "sandbox", policies: 12, violations: 0, status: "\ub3d9\uae30\ud654 \uc911" },
];

const toneStyles = {
  blue: "bg-blue-50 text-blue-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  rose: "bg-rose-50 text-rose-600",
};

export default function AdminDashboardPage() {
  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="admin" />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-20 items-center border-b border-slate-200 bg-white/95 px-5 backdrop-blur-sm sm:px-8">
          <button
            type="button"
            className="mr-3 flex size-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
            aria-label="\uba54\ub274 \uc5f4\uae30"
          >
            <Menu className="size-5" />
          </button>
          <div>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              {"\uad00\ub9ac\uc790 \ub300\uc2dc\ubcf4\ub4dc"}
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              {"\uc804\uccb4 \uc815\ucc45\uacfc \ud074\ub7ec\uc2a4\ud130 \uc0c1\ud0dc\ub97c \ud55c\ub208\uc5d0 \ud655\uc778\ud558\uc138\uc694."}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="hidden h-10 w-56 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs text-slate-400 md:flex"
            >
              <Search className="size-4" />
              {"\uc815\ucc45 \ub610\ub294 \ub9ac\uc18c\uc2a4 \uac80\uc0c9"}
            </button>
            <button
              type="button"
              className="relative flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              aria-label="\uc54c\ub9bc \ubcf4\uae30"
            >
              <Bell className="size-4.5" />
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-rose-500" />
            </button>
            <div className="ml-1 hidden items-center gap-2 sm:flex lg:hidden">
              <div className="flex size-9 items-center justify-center rounded-full bg-[#0b2342] text-xs font-semibold text-white">
                {"\uad00"}
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 p-5 sm:p-8">
          <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm text-slate-500">
                {"2026\ub144 7\uc6d4 8\uc77c \uc218\uc694\uc77c"}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
                {"\uc548\ub155\ud558\uc138\uc694, \uad00\ub9ac\uc790\ub2d8"}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {"\ub9c8\uc9c0\ub9c9 \uc5c5\ub370\uc774\ud2b8: \ubc29\uae08 \uc804"}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(({ label, value, detail, icon: Icon, tone, trend }) => (
              <article
                key={label}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <div className="flex items-start justify-between">
                  <div
                    className={`flex size-10 items-center justify-center rounded-xl ${
                      toneStyles[tone as keyof typeof toneStyles]
                    }`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <span
                    className={`flex items-center gap-0.5 text-xs font-medium ${
                      trend.startsWith("-") ? "text-emerald-600" : "text-slate-500"
                    }`}
                  >
                    {trend.startsWith("-") ? (
                      <ArrowDownRight className="size-3.5" />
                    ) : (
                      <ArrowUpRight className="size-3.5" />
                    )}
                    {trend}
                  </span>
                </div>
                <p className="mt-5 text-[13px] text-slate-500">{label}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
                <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
            <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                <div>
                  <h3 className="text-sm font-semibold">
                    {"\ucd5c\uadfc \uc815\ucc45 \uc704\ubc18"}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {"\uc0c8\ub86d\uac8c \uac10\uc9c0\ub41c \uc704\ubc18 \ud56d\ubaa9\uc785\ub2c8\ub2e4."}
                  </p>
                </div>
                <Link
                  href="/admin/violations"
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  {"\uc804\uccb4 \ubcf4\uae30"}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
              <div className="divide-y divide-slate-100">
                {violations.map((violation) => (
                  <div
                    key={`${violation.policy}-${violation.resource}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                  >
                    <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 sm:flex">
                      <ShieldAlert className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium">
                          {violation.policy}
                        </p>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                            violation.severity === "\ub192\uc74c"
                              ? "bg-rose-50 text-rose-600"
                              : violation.severity === "\uc911\uac04"
                                ? "bg-amber-50 text-amber-600"
                                : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {violation.severity}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {violation.resource} {" - "} {violation.cluster}
                      </p>
                    </div>
                    <div className="hidden items-center gap-1 text-[11px] text-slate-400 sm:flex">
                      <Clock3 className="size-3.5" />
                      {violation.time}
                    </div>
                    <ChevronRight className="size-4 text-slate-300" />
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h3 className="text-sm font-semibold">
                  {"\ud074\ub7ec\uc2a4\ud130 \uc0c1\ud0dc"}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {"\ub4f1\ub85d\ub41c \ud658\uacbd\uc758 \uc2e4\uc2dc\uac04 \uc0c1\ud0dc\uc785\ub2c8\ub2e4."}
                </p>
              </div>
              <div className="space-y-1 p-3">
                {clusterStatus.map((cluster) => (
                  <div
                    key={cluster.name}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-slate-50"
                  >
                    <div
                      className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                        cluster.status === "\uc815\uc0c1"
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-blue-50 text-blue-600"
                      }`}
                    >
                      {cluster.status === "\uc815\uc0c1" ? (
                        <CheckCircle2 className="size-4.5" />
                      ) : (
                        <Server className="size-4.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{cluster.name}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {"\uc815\ucc45"} {cluster.policies} {" - "}
                        {"\uc704\ubc18"} {cluster.violations}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-medium ${
                        cluster.status === "\uc815\uc0c1" ? "text-emerald-600" : "text-blue-600"
                      }`}
                    >
                      {cluster.status}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
