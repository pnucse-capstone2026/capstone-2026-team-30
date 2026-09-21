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

  const logs = liveLogs ?? [];
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
      <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <SummaryCard
          label="전체 로그"
          value={String(logs.length)}
          detail="최근 작업 이력"
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

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {/* 컴팩트 1열 통합 필터 헤더 */}
        <div className="border-b border-slate-100 px-5 py-3 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                작업 이력 ({filteredLogs.length}건)
              </h2>
              <p className="text-xs text-slate-500">
                작업자, 액션, 대상 리소스, 생성 시각을 기준으로 운영 이력을 확인합니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="작업, 대상, 작업자 검색"
                  className="h-8.5 w-48 rounded-xl border-slate-200 bg-slate-50 pr-3 pl-8 text-xs"
                />
              </div>

              <select
                value={entityType}
                onChange={(event) =>
                  setEntityType(event.target.value as EntityFilter)
                }
                className="h-8.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-blue-500"
              >
                <option value="all">전체 대상</option>
                {entityOptions.map((option) => (
                  <option key={option} value={option}>
                    {entityTypeLabel[option]}
                  </option>
                ))}
              </select>

              <select
                value={actorRole}
                onChange={(event) =>
                  setActorRole(event.target.value as ActorRoleFilter)
                }
                className="h-8.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-blue-500"
              >
                <option value="all">전체 역할</option>
                {actorRoleOptions.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel[option]}
                  </option>
                ))}
              </select>

              <Button
                variant="outline"
                size="sm"
                className="h-8.5 rounded-xl border-slate-200 text-xs text-slate-600 gap-1 px-2.5"
                onClick={resetFilters}
              >
                <Filter className="size-3" />
                초기화
              </Button>
            </div>
          </div>
        </div>

        <div className="relative w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                <TableHead className="w-[180px] px-4 text-xs font-semibold text-slate-600">
                  발생 시간
                </TableHead>
                <TableHead className="w-[160px] text-xs font-semibold text-slate-600">
                  작업
                </TableHead>
                <TableHead className="w-[160px] text-xs font-semibold text-slate-600">
                  대상
                </TableHead>
                <TableHead className="w-[200px] text-xs font-semibold text-slate-600">
                  작업자
                </TableHead>
                <TableHead className="min-w-[280px] pr-4 text-xs font-semibold text-slate-600">
                  요약
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveLogs === null
                ? [1, 2, 3, 4].map((key) => (
                    <TableRow key={key}>
                      <TableCell className="px-4 py-2.5">
                        <Skeleton className="h-4 w-28 rounded" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-4 w-20 rounded" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-4 w-16 rounded" />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Skeleton className="h-4 w-24 rounded" />
                      </TableCell>
                      <TableCell className="py-2.5 pr-4">
                        <Skeleton className="h-4 w-40 rounded" />
                      </TableCell>
                    </TableRow>
                  ))
                : filteredLogs.map((log) => (
                    <TableRow key={log.id} className="hover:bg-slate-50/60">
                      <TableCell className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 text-xs text-slate-700">
                          <Clock3 className="size-3.5 text-slate-400 shrink-0" />
                          <span>{log.createdAt}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Activity className="size-3.5 text-slate-400 shrink-0" />
                          <span className="font-mono text-xs font-medium text-slate-900">
                            {log.action}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Badge className={`${entityTypeClassName[log.entityType]} text-[10px] px-1.5 py-0`}>
                            {entityTypeLabel[log.entityType]}
                          </Badge>
                          <span className="max-w-[130px] truncate font-mono text-[11px] text-slate-500" title={log.entityId}>
                            {log.entityId}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <p className="text-xs font-medium text-slate-900 truncate max-w-[190px]" title={log.actorEmail}>
                          {log.actorEmail}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {roleLabel[log.actorRole]} ({log.actorRole})
                        </p>
                      </TableCell>
                      <TableCell className="py-2.5 pr-4">
                        <p className="text-xs leading-relaxed text-slate-700">
                          {log.summary}
                        </p>
                        {log.metadata && (
                          <p className="truncate font-mono text-[10px] text-slate-400 max-w-[400px]" title={log.metadata}>
                            {log.metadata}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="border-t border-slate-100 px-5 py-8 text-center text-xs text-slate-500">
            조건에 맞는 감사 로그가 없습니다.
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            {filteredLogs.length} / {logs.length}개 로그 표시
          </span>
          <span>플랫폼 작업 및 보안 감사 이력</span>
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
    <article className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-7 w-16 rounded" />
        ) : (
          <p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
        )}
        <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>
      </div>
      <div className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shrink-0">
        <Icon className="size-4.5" />
      </div>
    </article>
  );
}
