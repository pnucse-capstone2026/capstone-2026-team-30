"use client";
import {
  Activity,
  Clock3,
  Download,
  Filter,
  History,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  auditLogs,
  entityTypeClassName,
  entityTypeLabel,
  getAuditLogs,
  type AuditLog,
} from "@/lib/audit-logs";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import { useCallback, useEffect, useMemo, useState } from "react";

type EntityFilter = "all" | AuditLog["entityType"];
type ActorRoleFilter = "all" | AuditLog["actorRole"];

const roleLabel: Record<AuditLog["actorRole"], string> = {
  ADMIN: "관리자",
  APPROVER: "승인자",
  REQUESTER: "요청자",
  VIEWER: "조회자",
  SYSTEM: "시스템",
};

export default function AdminAuditLogsPage() {
  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState<EntityFilter>("all");
  const [actorRole, setActorRole] = useState<ActorRoleFilter>("all");

  const liveLogs = useDataStore((state) => state.auditLogs);
  const fetchAuditLogs = useDataStore((state) => state.fetchAuditLogs);

  const initializeAuth = useAuthStore((state) => state.initialize);

  const loadLogs = useCallback(async () => {
    try {
      await initializeAuth();
      await fetchAuditLogs();
    } catch {
      // Graceful fallback
    }
  }, [fetchAuditLogs, initializeAuth]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const logs = liveLogs ?? auditLogs;
  const isLive = liveLogs !== null;

  const entityOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.entityType))),
    [logs],
  );
  const actorRoleOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.actorRole))),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return logs.filter((log) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [
          log.action,
          log.entityType,
          log.entityId,
          log.actorEmail,
          log.summary,
          log.metadata,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return (
        matchesQuery &&
        (entityType === "all" || log.entityType === entityType) &&
        (actorRole === "all" || log.actorRole === actorRole)
      );
    });
  }, [logs, actorRole, entityType, query]);

  function resetFilters() {
    setQuery("");
    setEntityType("all");
    setActorRole("all");
  }

  return (
    <DashboardPageShell
      variant="admin"
      activeHref="/admin/audit-logs"
      title="감사 로그"
      description="관리자 작업과 주요 리소스 변경 이력을 추적합니다."
      actions={
        <Button
          variant="outline"
          className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
        >
          <Download className="size-4" />
          내보내기
        </Button>
      }
    >
      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="전체 로그"
          value={String(logs.length)}
          detail={isLive ? "라이브 수집 이력" : "최근 작업 이력"}
          icon={History}
          loading={liveLogs === null}
        />
        <SummaryCard
          label="사용자 작업"
          value={String(logs.filter((log) => log.entityType === "USER").length)}
          detail="계정 및 권한 변경"
          icon={UserRound}
          loading={liveLogs === null}
        />
        <SummaryCard
          label="정책 관련"
          value={String(
            logs.filter(
              (log) =>
                log.entityType === "POLICY" ||
                log.entityType === "POLICY_EXCEPTION_REQUEST" ||
                log.entityType === "VIOLATION_HISTORY",
            ).length,
          )}
          detail="정책, 예외, 오류"
          icon={ShieldCheck}
          loading={liveLogs === null}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                  {isLive ? "라이브 API 연동" : "AuditLog"}
                </Badge>
                <span className="text-xs text-slate-400">
                  {isLive
                    ? "백엔드 AuditLog DB 실시간 연동 중"
                    : "플랫폼 작업 이력 실시간 관리"}
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                작업 이력
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                작업자, 액션, 대상 리소스, 생성 시각을 기준으로 운영 이력을
                확인합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="작업, 대상, 작업자 검색"
                  className="h-10 w-full rounded-xl border-slate-200 bg-slate-50 pr-3 pl-9 text-xs lg:w-72"
                />
              </div>
              <Button
                variant="outline"
                className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
                onClick={resetFilters}
              >
                <Filter className="size-4" />
                필터 초기화
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-500">
                대상 유형
              </span>
              <select
                value={entityType}
                onChange={(event) =>
                  setEntityType(event.target.value as EntityFilter)
                }
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
              >
                <option value="all">전체 대상</option>
                {entityOptions.map((option) => (
                  <option key={option} value={option}>
                    {entityTypeLabel[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-medium text-slate-500">
                작업자 역할
              </span>
              <select
                value={actorRole}
                onChange={(event) =>
                  setActorRole(event.target.value as ActorRoleFilter)
                }
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-3 focus:ring-blue-500/10"
              >
                <option value="all">전체 역할</option>
                {actorRoleOptions.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel[option]} ({option})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
              <TableHead className="w-[220px] px-5 text-xs text-slate-500 sm:px-6">
                발생 시간
              </TableHead>
              <TableHead className="text-xs text-slate-500">작업</TableHead>
              <TableHead className="text-xs text-slate-500">대상</TableHead>
              <TableHead className="text-xs text-slate-500">작업자</TableHead>
              <TableHead className="text-xs text-slate-500">요약</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {liveLogs === null
              ? [1, 2, 3].map((key) => (
                  <TableRow key={key}>
                    <TableCell className="px-5 py-4 sm:px-6">
                      <Skeleton className="h-5 w-32 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-24 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-20 rounded-lg" />
                    </TableCell>
                    <TableCell className="py-4">
                      <Skeleton className="h-5 w-28 rounded-lg" />
                    </TableCell>
                    <TableCell className="max-w-[420px] py-4 pr-5 sm:pr-6">
                      <Skeleton className="h-5 w-48 rounded-lg" />
                    </TableCell>
                  </TableRow>
                ))
              : filteredLogs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-slate-50/70">
                    <TableCell className="px-5 py-4 sm:px-6">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Clock3 className="size-4 text-slate-400" />
                        {log.createdAt}
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-slate-400">
                        {log.id}
                      </p>
                    </TableCell>
                    <TableCell className="py-4">
                      <div className="flex items-center gap-2">
                        <Activity className="size-4 text-slate-400" />
                        <span className="font-mono text-xs font-medium text-slate-900">
                          {log.action}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="py-4">
                      <Badge className={entityTypeClassName[log.entityType]}>
                        {entityTypeLabel[log.entityType]}
                      </Badge>
                      <p className="mt-1 max-w-[220px] truncate font-mono text-[11px] text-slate-400">
                        {log.entityId}
                      </p>
                    </TableCell>
                    <TableCell className="py-4">
                      <p className="text-xs font-medium text-slate-900">
                        {log.actorEmail}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {roleLabel[log.actorRole]} ({log.actorRole})
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[420px] py-4 pr-5 sm:pr-6">
                      <p className="text-xs leading-5 text-slate-700">
                        {log.summary}
                      </p>
                      <p className="mt-1 truncate font-mono text-[11px] text-slate-400">
                        {log.metadata}
                      </p>
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>

        {filteredLogs.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-10 text-center text-sm text-slate-500">
            조건에 맞는 감사 로그가 없습니다.
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            {filteredLogs.length} / {logs.length}개 로그 표시
          </span>
          <span>
            {isLive
              ? "백엔드 AuditLog DB와 감사 이력이 성공적으로 연동되었습니다."
              : "백엔드 연동 불가 시 기본 목업 감사 이력이 표시됩니다."}
          </span>
        </div>
      </section>
    </DashboardPageShell>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof History;
  loading?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between">
        <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-5 text-[13px] text-slate-500">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-9 w-20 rounded-lg" />
      ) : (
        <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      )}
      <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
    </article>
  );
}
