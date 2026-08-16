"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Clock3,
  Fingerprint,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type UserRole } from "@/lib/auth-api";
import { useAuthStore } from "@/lib/auth-store";

const roleLabel: Record<UserRole, string> = {
  ADMIN: "관리자",
  APPROVER: "승인자",
  REQUESTER: "요청자",
  VIEWER: "조회자",
};

const roleDescription: Record<UserRole, string> = {
  ADMIN: "사용자, 정책, 예외, 감사 로그를 포함한 운영 기능을 관리할 수 있습니다.",
  APPROVER: "정책 예외 신청을 검토하고 승인 또는 거절할 수 있습니다.",
  REQUESTER: "정책 상태를 확인하고 필요한 정책 예외를 신청할 수 있습니다.",
  VIEWER: "정책, 클러스터, 위반 현황을 조회할 수 있습니다.",
};

const roleBadgeClass: Record<UserRole, string> = {
  ADMIN: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  APPROVER: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  REQUESTER: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  VIEWER: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

export default function MyProfilePage() {
  const { initialize, status, user } = useAuthStore();
  const isRefreshing = status === "loading";
  const sidebarVariant =
    user?.role === "ADMIN" || user?.role === "APPROVER" ? "admin" : "user";

  return (
    <DashboardPageShell
      variant={sidebarVariant}
      activeHref="/me"
      title="내 정보"
      description="로그인한 계정과 현재 권한을 확인합니다."
      actions={
        <Button
          type="button"
          variant="outline"
          className="hidden h-10 gap-2 rounded-xl sm:inline-flex"
          onClick={() => void initialize()}
          disabled={isRefreshing}
        >
          <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
          새로고침
        </Button>
      }
    >
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#0b2342] text-lg font-semibold text-white">
                {user?.email.slice(0, 1).toUpperCase() ?? "U"}
              </div>
              <div>
                <Badge className={user ? roleBadgeClass[user.role] : "bg-slate-100 text-slate-600"}>
                  {user ? roleLabel[user.role] : "확인 중"}
                </Badge>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                  {user?.email ?? "계정 정보를 불러오는 중"}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  {user
                    ? roleDescription[user.role]
                    : "로그인 세션을 확인하고 있습니다."}
                </p>
              </div>
            </div>
            <Badge className="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <CheckCircle2 className="size-3" />
              로그인됨
            </Badge>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <InfoCard
              icon={Mail}
              label="이메일"
              value={user?.email ?? "-"}
              detail="로그인 계정"
            />
            <InfoCard
              icon={ShieldCheck}
              label="역할"
              value={user ? roleLabel[user.role] : "-"}
              detail={user?.role ?? "ROLE"}
            />
            <InfoCard
              icon={Fingerprint}
              label="사용자 ID"
              value={user?.id ?? "-"}
              detail="API 식별자"
              mono
            />
          </div>
        </article>

        <aside className="space-y-6">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <UserRound className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">계정 상태</h3>
                <p className="mt-1 text-xs text-slate-500">
                  현재 세션 기준 정보입니다.
                </p>
              </div>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">인증 상태</dt>
                <dd className="font-medium text-emerald-700">활성</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">세션 확인</dt>
                <dd className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock3 className="size-3.5" />
                  새로고침 가능
                </dd>
              </div>
            </dl>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold">빠른 이동</h3>
            <div className="mt-4 grid gap-2">
              <Button
                asChild
                variant="outline"
                className="h-10 justify-start rounded-xl border-slate-200 bg-white"
              >
                <Link href="/exceptions">
                  <ShieldCheck className="size-4" />
                  내 예외 신청 보기
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-10 justify-start rounded-xl border-slate-200 bg-white"
              >
                <Link href="/exceptions/new">
                  <KeyRound className="size-4" />
                  새 예외 신청
                </Link>
              </Button>
              {user?.role === "ADMIN" ? (
                <Button
                  asChild
                  variant="outline"
                  className="h-10 justify-start rounded-xl border-slate-200 bg-white"
                >
                  <Link href="/admin/users">
                    <UserRound className="size-4" />
                    사용자 관리
                  </Link>
                </Button>
              ) : null}
            </div>
          </article>
        </aside>
      </section>
    </DashboardPageShell>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  detail,
  mono,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  detail: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <Icon className="size-4 text-slate-400" />
        {label}
      </div>
      <p
        className={`mt-3 truncate text-sm font-semibold text-slate-950 ${
          mono ? "font-mono text-xs" : ""
        }`}
        title={value}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
    </div>
  );
}
