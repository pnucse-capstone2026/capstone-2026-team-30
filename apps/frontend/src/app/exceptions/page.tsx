import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock3,
  FilePlus2,
  FileSearch,
  Filter,
  Menu,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  exceptionRequests,
  exceptionStatusClassName,
  exceptionStatusLabel,
  type ExceptionRequestStatus,
} from "@/lib/exception-requests";

const summaryCards = [
  {
    label: "전체 신청",
    value: exceptionRequests.length.toString(),
    detail: "내가 신청한 예외",
    icon: FileSearch,
    className: "bg-blue-50 text-blue-600",
  },
  {
    label: "승인 대기",
    value: exceptionRequests.filter((item) => item.status === "pending").length.toString(),
    detail: "관리자 검토 필요",
    icon: Clock3,
    className: "bg-amber-50 text-amber-600",
  },
  {
    label: "승인",
    value: exceptionRequests.filter((item) => item.status === "approved").length.toString(),
    detail: "현재 적용 중",
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-600",
  },
  {
    label: "거절·만료",
    value: exceptionRequests.filter((item) => item.status === "rejected" || item.status === "expired").length.toString(),
    detail: "재신청 또는 조치 필요",
    icon: XCircle,
    className: "bg-rose-50 text-rose-600",
  },
];

const filters = [
  {
    label: "처리 상태",
    options: ["전체 상태", "대기", "승인", "거절", "만료"],
  },
  {
    label: "정책",
    options: ["전체 정책", "require-resource-limits", "disallow-latest-tag", "restrict-host-path"],
  },
  {
    label: "클러스터",
    options: ["전체 클러스터", "production", "staging", "development", "sandbox"],
  },
];

const statusIcon: Record<ExceptionRequestStatus, typeof Clock3> = {
  pending: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  expired: AlertCircle,
};

const stateSamples = [
  {
    title: "로딩",
    description: "신청 내역을 불러오는 동안 스켈레톤 행을 표시합니다.",
    className: "border-blue-100 bg-blue-50 text-blue-700",
  },
  {
    title: "데이터 없음",
    description: "아직 예외 신청이 없으면 신청 버튼을 중심으로 안내합니다.",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
  {
    title: "검색 결과 없음",
    description: "검색어와 필터를 초기화할 수 있는 액션을 제공합니다.",
    className: "border-amber-100 bg-amber-50 text-amber-700",
  },
  {
    title: "오류",
    description: "목록 조회 실패 시 재시도 버튼과 오류 요약을 표시합니다.",
    className: "border-rose-100 bg-rose-50 text-rose-700",
  },
  {
    title: "권한 없음",
    description: "본인 신청 내역만 볼 수 있다는 안내를 표시합니다.",
    className: "border-violet-100 bg-violet-50 text-violet-700",
  },
];

export default function MyExceptionRequestsPage() {
  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="user" activeHref="/exceptions" />

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
              내 예외 신청
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              내가 신청한 정책 예외의 처리 상태와 만료일을 확인하세요.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              className="hidden h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] sm:inline-flex"
            >
              <Link href="/exceptions/new">
                <FilePlus2 className="size-4" />
                예외 신청
              </Link>
            </Button>
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
          <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  사용자
                </Badge>
                <span className="text-xs text-slate-400">
                  최근 신청일 기준으로 정렬되었습니다.
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                신청 내역
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                승인 대기, 승인, 거절, 만료 상태를 확인하고 필요한 경우 새 예외를 신청합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
              >
                <SlidersHorizontal className="size-4" />
                보기 설정
              </Button>
              <Button
                asChild
                className="h-10 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
              >
                <Link href="/exceptions/new">
                  <FilePlus2 className="size-4" />
                  새 신청
                </Link>
              </Button>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(({ label, value, detail, icon: Icon, className }) => (
              <article
                key={label}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <div className="flex items-start justify-between">
                  <div className={`flex size-10 items-center justify-center rounded-xl ${className}`}>
                    <Icon className="size-5" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-400">
                    mine
                  </span>
                </div>
                <p className="mt-5 text-[13px] text-slate-500">{label}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
                <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">신청 내역 검색</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    정책명, 리소스, 신청 사유로 내역을 찾을 수 있습니다.
                  </p>
                </div>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative">
                    <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      type="search"
                      placeholder="정책명 또는 신청 사유 검색"
                      className="h-10 w-full rounded-xl border-slate-200 bg-slate-50 pr-3 pl-9 text-xs lg:w-72"
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                  >
                    <Filter className="size-4" />
                    필터 초기화
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {filters.map((filter) => (
                  <label key={filter.label} className="space-y-1.5">
                    <span className="text-[11px] font-medium text-slate-500">
                      {filter.label}
                    </span>
                    <select className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10">
                      {filter.options.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                  <TableHead className="w-[210px] px-5 text-xs text-slate-500 sm:px-6">
                    신청 번호
                  </TableHead>
                  <TableHead className="text-xs text-slate-500">정책명</TableHead>
                  <TableHead className="text-xs text-slate-500">신청 사유</TableHead>
                  <TableHead className="text-xs text-slate-500">신청일</TableHead>
                  <TableHead className="text-xs text-slate-500">만료일</TableHead>
                  <TableHead className="text-xs text-slate-500">처리 상태</TableHead>
                  <TableHead className="w-20 text-xs text-slate-500">상세</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptionRequests.map((request) => {
                  const StatusIcon = statusIcon[request.status];

                  return (
                    <TableRow key={request.id} className="hover:bg-slate-50/70">
                      <TableCell className="px-5 py-4 sm:px-6">
                        <div>
                          <p className="text-xs font-semibold text-slate-900">
                            {request.id}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {request.clusterName} · {request.namespace}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex items-center gap-3">
                          <div className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 sm:flex">
                            <ShieldAlert className="size-4.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-slate-900">
                              {request.policyName}
                            </p>
                            <p className="mt-1 truncate text-[11px] text-slate-400">
                              {request.resourceKind} / {request.resourceName}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[360px] py-4">
                        <p className="line-clamp-2 text-xs leading-5 text-slate-500">
                          {request.reason}
                        </p>
                      </TableCell>
                      <TableCell className="py-4 text-xs text-slate-500">
                        {request.requestedAt}
                      </TableCell>
                      <TableCell className="py-4 text-xs text-slate-500">
                        {request.expiresAt}
                      </TableCell>
                      <TableCell className="py-4">
                        <Badge className={exceptionStatusClassName[request.status]}>
                          <StatusIcon className="size-3" />
                          {exceptionStatusLabel[request.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-4 pr-5 sm:pr-6">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="rounded-lg border-slate-200 bg-white"
                        >
                          <Link href="#">
                            보기
                            <ArrowRight className="size-3.5" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>

          <section className="grid gap-4 lg:grid-cols-5">
            {stateSamples.map((state) => (
              <article
                key={state.title}
                className={`rounded-2xl border px-4 py-4 ${state.className}`}
              >
                <h3 className="text-sm font-semibold">{state.title}</h3>
                <p className="mt-2 text-xs leading-5 opacity-80">
                  {state.description}
                </p>
              </article>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
