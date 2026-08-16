import Link from "next/link";
import {
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
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";

const summaryCards = [
  {
    label: "\ub0b4 \ud074\ub7ec\uc2a4\ud130",
    value: "2",
    detail: "production, staging",
    icon: Server,
    tone: "blue",
    trend: "+1",
  },
  {
    label: "\ub0b4\uac00 \uad00\ub9ac \uc911\uc778 \uc815\ucc45",
    value: "8",
    detail: "\uc9c0\ub09c\uc8fc \ub300\ube44 \uc99d\uac00",
    icon: FileCheck2,
    tone: "emerald",
    trend: "+2",
  },
  {
    label: "\ub0b4 \ub9ac\uc18c\uc2a4 \uc704\ubc18",
    value: "4",
    detail: "\uc6b0\uc120 \ud655\uc778 1\uac74",
    icon: ShieldAlert,
    tone: "amber",
    trend: "-3",
  },
  {
    label: "\uc815\uc0c1 \uc815\ucc45 \ube44\uc728",
    value: "92%",
    detail: "\ub0b4 \ud560\ub2f9 \ubc94\uc704 \uae30\uc900",
    icon: ShieldCheck,
    tone: "cyan",
    trend: "+5%",
  },
];

const assignedPolicies = [
  {
    policy: "require-resource-limits",
    target: "Deployment / payment-api",
    cluster: "production",
    status: "\uc218\uc815 \ud544\uc694",
    time: "5\ubd84 \uc804",
  },
  {
    policy: "disallow-latest-tag",
    target: "Pod / worker-7f86c",
    cluster: "staging",
    status: "\uac80\ud1a0 \uc911",
    time: "18\ubd84 \uc804",
  },
  {
    policy: "require-team-label",
    target: "Service / user-service",
    cluster: "production",
    status: "\uc644\ub8cc",
    time: "42\ubd84 \uc804",
  },
];

const myClusters = [
  { name: "production", policies: 6, violations: 3, status: "\uc815\uc0c1" },
  { name: "staging", policies: 2, violations: 1, status: "\uc815\uc0c1" },
];

const toneStyles = {
  blue: "bg-blue-50 text-blue-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  cyan: "bg-cyan-50 text-cyan-600",
};

export default function UserDashboardPage() {
  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="user" />

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
              {"\ub0b4 \ub300\uc2dc\ubcf4\ub4dc"}
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              {"\ud560\ub2f9\ub41c \ud074\ub7ec\uc2a4\ud130\uc640 \uc815\ucc45 \uc0c1\ud0dc\ub97c \ud655\uc778\ud558\uc138\uc694."}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="hidden h-10 w-56 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs text-slate-400 md:flex"
            >
              <Search className="size-4" />
              {"\ub0b4 \uc815\ucc45 \ub610\ub294 \ub9ac\uc18c\uc2a4 \uac80\uc0c9"}
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
                {"\uc0ac"}
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
                {"\uc548\ub155\ud558\uc138\uc694, \uc0ac\uc6a9\uc790\ub2d8"}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              {"\ub0b4 \uc791\uc5c5 \ubaa9\ub85d \ub3d9\uae30\ud654 \uc644\ub8cc"}
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(({ label, value, detail, icon: Icon, tone, trend }) => (
              <Link
                key={label}
                href={label === "내 리소스 위반" ? "/violations" : "/dashboard"}
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
              </Link>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
            <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                <div>
                  <h3 className="text-sm font-semibold">
                    {"\ub0b4 \ud560\ub2f9 \uc815\ucc45 \uc791\uc5c5"}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {"\uc870\uce58\uac00 \ud544\uc694\ud55c \ud56d\ubaa9\uc744 \uc6b0\uc120\uc21c\uc73c\ub85c \ubcf4\uc5ec\uc90d\ub2c8\ub2e4."}
                  </p>
                </div>
                <Link
                  href="/violations"
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  {"전체 보기"}
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
              <div className="divide-y divide-slate-100">
                {assignedPolicies.map((item) => (
                  <Link
                    key={`${item.policy}-${item.target}`}
                    href="/violations"
                    className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 sm:px-6"
                  >
                    <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 sm:flex">
                      <ShieldCheck className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium">
                          {item.policy}
                        </p>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                            item.status === "\uc218\uc815 \ud544\uc694"
                              ? "bg-rose-50 text-rose-600"
                              : item.status === "\uac80\ud1a0 \uc911"
                                ? "bg-amber-50 text-amber-600"
                                : "bg-emerald-50 text-emerald-600"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {item.target} {" - "} {item.cluster}
                      </p>
                    </div>
                    <div className="hidden items-center gap-1 text-[11px] text-slate-400 sm:flex">
                      <Clock3 className="size-3.5" />
                      {item.time}
                    </div>
                    <ChevronRight className="size-4 text-slate-300" />
                  </Link>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <h3 className="text-sm font-semibold">
                  {"\ub0b4 \ud074\ub7ec\uc2a4\ud130 \uc0c1\ud0dc"}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {"\uc811\uadfc \uad8c\ud55c\uc774 \uc788\ub294 \ud658\uacbd\ub9cc \ud45c\uc2dc\ub429\ub2c8\ub2e4."}
                </p>
              </div>
              <div className="space-y-1 p-3">
                {myClusters.map((cluster) => (
                  <div
                    key={cluster.name}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-slate-50"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <CheckCircle2 className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{cluster.name}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {"\ub0b4 \uc815\ucc45"} {cluster.policies} {" - "}
                        {"\uc704\ubc18"} {cluster.violations}
                      </p>
                    </div>
                    <span className="text-[10px] font-medium text-emerald-600">
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
