"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Menu,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  UserCog,
  UserMinus,
  UserPlus,
} from "lucide-react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, type UserRole } from "@/lib/auth-api";
import { type ClusterMetadata, listClusterCatalog } from "@/lib/clusters";
import {
  createUser,
  listUsers,
  type ManagedUser,
  resetUserPassword,
  setUserDisabled,
  setUserClusters,
  updateUserRole,
} from "@/lib/users-api";

const roleOptions: UserRole[] = ["ADMIN", "APPROVER", "REQUESTER", "VIEWER"];

const roleLabel: Record<UserRole, string> = {
  ADMIN: "관리자",
  APPROVER: "승인자",
  REQUESTER: "요청자",
  VIEWER: "조회자",
};

const roleBadgeClass: Record<UserRole, string> = {
  ADMIN: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  APPROVER: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  REQUESTER: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  VIEWER: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

function normalizeClusterIds(clusterIds: string[]) {
  return [...new Set(clusterIds.map((clusterId) => clusterId.trim()))].sort();
}

function buildClusterState(users: ManagedUser[]) {
  return Object.fromEntries(
    users.map((user) => [user.id, normalizeClusterIds(user.clusterIds)]),
  );
}

function clusterIdsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((clusterId, index) => clusterId === right[index]);
}

function getClusterName(clusters: ClusterMetadata[], clusterId: string) {
  return (
    clusters.find((cluster) => cluster.id === clusterId)?.displayName ??
    clusterId
  );
}

type CreateForm = {
  email: string;
  password: string;
  role: UserRole;
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [createForm, setCreateForm] = useState<CreateForm>({
    email: "",
    password: "",
    role: "REQUESTER",
  });
  const [passwordByUserId, setPasswordByUserId] = useState<
    Record<string, string>
  >({});
  const [availableClusters, setAvailableClusters] = useState<ClusterMetadata[]>(
    [],
  );
  const [clusterSelectionByUserId, setClusterSelectionByUserId] = useState<
    Record<string, string[]>
  >({});
  const [savedClusterIdsByUserId, setSavedClusterIdsByUserId] = useState<
    Record<string, string[]>
  >({});
  const [clustersLoading, setClustersLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeUsers = useMemo(
    () => users.filter((user) => !user.disabledAt).length,
    [users],
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const loadedUsers = await listUsers();
      const clusterState = buildClusterState(loadedUsers);
      setUsers(loadedUsers);
      setClusterSelectionByUserId(clusterState);
      setSavedClusterIdsByUserId(clusterState);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "사용자 목록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAvailableClusters = useCallback(async () => {
    setClustersLoading(true);
    setError(null);

    try {
      setAvailableClusters(await listClusterCatalog());
    } catch (loadError) {
      setError(
        loadError instanceof ApiError && loadError.statusCode === 403
          ? "클러스터 배정 권한이 없습니다."
          : loadError instanceof Error
            ? loadError.message
            : "클러스터 목록을 불러오지 못했습니다.",
      );
    } finally {
      setClustersLoading(false);
    }
  }, []);

  const reloadPageData = useCallback(async () => {
    await Promise.all([loadUsers(), loadAvailableClusters()]);
  }, [loadAvailableClusters, loadUsers]);

  useEffect(() => {
    void reloadPageData();
  }, [reloadPageData]);

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("create");
    setError(null);
    setMessage(null);

    try {
      const user = await createUser({
        email: createForm.email,
        password: createForm.password,
        role: createForm.role,
      });
      setUsers((currentUsers) => [user, ...currentUsers]);
      const clusterIds = normalizeClusterIds(user.clusterIds);
      setClusterSelectionByUserId((current) => ({
        ...current,
        [user.id]: clusterIds,
      }));
      setSavedClusterIdsByUserId((current) => ({
        ...current,
        [user.id]: clusterIds,
      }));
      setCreateForm({ email: "", password: "", role: "REQUESTER" });
      setMessage("사용자를 추가했습니다.");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "사용자를 추가하지 못했습니다.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    setSaving(`role-${userId}`);
    setError(null);
    setMessage(null);

    try {
      const user = await updateUserRole(userId, role);
      replaceUser(user);
      setMessage("역할을 변경했습니다.");
    } catch (roleError) {
      setError(
        roleError instanceof Error
          ? roleError.message
          : "역할을 변경하지 못했습니다.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function handlePasswordReset(user: ManagedUser) {
    const password = passwordByUserId[user.id]?.trim();

    if (!password) {
      setError("새 비밀번호를 입력해주세요.");
      return;
    }

    setSaving(`password-${user.id}`);
    setError(null);
    setMessage(null);

    try {
      const updatedUser = await resetUserPassword(user.id, password);
      replaceUser(updatedUser);
      setPasswordByUserId((current) => ({ ...current, [user.id]: "" }));
      setMessage(`${user.email} 비밀번호를 변경했습니다.`);
    } catch (passwordError) {
      setError(
        passwordError instanceof Error
          ? passwordError.message
          : "비밀번호를 변경하지 못했습니다.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function handleDisabledToggle(user: ManagedUser) {
    const disabled = !user.disabledAt;
    setSaving(`disabled-${user.id}`);
    setError(null);
    setMessage(null);

    try {
      const updatedUser = await setUserDisabled(user.id, disabled);
      replaceUser(updatedUser);
      setMessage(
        disabled ? "사용자를 비활성화했습니다." : "사용자를 활성화했습니다.",
      );
    } catch (disabledError) {
      setError(
        disabledError instanceof Error
          ? disabledError.message
          : "사용자 상태를 변경하지 못했습니다.",
      );
    } finally {
      setSaving(null);
    }
  }

  function handleClusterSelectionChange(
    userId: string,
    clusterId: string,
    checked: boolean,
  ) {
    setClusterSelectionByUserId((current) => {
      const selected = new Set(current[userId] ?? []);

      if (checked) {
        selected.add(clusterId);
      } else {
        selected.delete(clusterId);
      }

      return {
        ...current,
        [userId]: Array.from(selected).sort(),
      };
    });
  }

  async function handleClusterSave(user: ManagedUser) {
    const clusterIds = normalizeClusterIds(
      clusterSelectionByUserId[user.id] ?? [],
    );
    setSaving(`clusters-${user.id}`);
    setError(null);
    setMessage(null);

    try {
      const result = await setUserClusters(user.id, clusterIds);
      const savedClusterIds = normalizeClusterIds(result.clusterIds);
      replaceUser(result);
      setClusterSelectionByUserId((current) => ({
        ...current,
        [user.id]: savedClusterIds,
      }));
      setSavedClusterIdsByUserId((current) => ({
        ...current,
        [user.id]: savedClusterIds,
      }));
      setMessage(`${user.email} 클러스터 배정을 저장했습니다.`);
    } catch (clusterError) {
      setError(
        clusterError instanceof Error
          ? clusterError.message
          : "클러스터 배정을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(null);
    }
  }

  function replaceUser(user: ManagedUser) {
    setUsers((currentUsers) =>
      currentUsers.map((currentUser) =>
        currentUser.id === user.id ? user : currentUser,
      ),
    );
  }

  return (
    <main className="flex min-h-dvh bg-[#f4f7fb] text-slate-950">
      <DashboardSidebar variant="admin" activeHref="/admin/users" />

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
              사용자 관리
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              계정, 역할, 비밀번호, 활성 상태를 관리합니다.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="ml-auto h-10 gap-2 rounded-xl"
            onClick={() => void reloadPageData()}
            disabled={loading || clustersLoading}
          >
            <RefreshCw
              className={`size-4 ${
                loading || clustersLoading ? "animate-spin" : ""
              }`}
            />
            새로고침
          </Button>
        </header>

        <div className="w-full space-y-6 p-5 sm:p-8">
          <section className="grid gap-4 md:grid-cols-3">
            <SummaryCard
              label="전체 사용자"
              value={String(users.length)}
              icon={UserCog}
              detail="등록된 계정"
            />
            <SummaryCard
              label="활성 사용자"
              value={String(activeUsers)}
              icon={CheckCircle2}
              detail="로그인 가능"
            />
            <SummaryCard
              label="관리자"
              value={String(
                users.filter((user) => user.role === "ADMIN").length,
              )}
              icon={ShieldCheck}
              detail="전체 권한"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <form
              onSubmit={handleCreateUser}
              className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              <div className="mb-5 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <UserPlus className="size-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">사용자 추가</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    새 계정과 초기 권한을 지정합니다.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-user-email">이메일</Label>
                  <Input
                    id="new-user-email"
                    type="email"
                    value={createForm.email}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    required
                    className="h-11"
                    placeholder="user@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-password">초기 비밀번호</Label>
                  <Input
                    id="new-user-password"
                    type="password"
                    value={createForm.password}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    required
                    className="h-11"
                    placeholder="비밀번호"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-user-role">역할</Label>
                  <select
                    id="new-user-role"
                    value={createForm.role}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        role: event.target.value as UserRole,
                      }))
                    }
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/15"
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel[role]} ({role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={saving === "create"}
                className="mt-5 h-11 w-full gap-2 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
              >
                {saving === "create" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                사용자 추가
              </Button>
            </form>

            <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
                <div>
                  <h2 className="text-sm font-semibold">사용자 목록</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    역할 변경, 비밀번호 재설정, 비활성화를 처리합니다.
                  </p>
                </div>
              </div>

              {message ? (
                <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-3 text-xs text-emerald-700 sm:px-6">
                  {message}
                </div>
              ) : null}
              {error ? (
                <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-xs text-rose-700 sm:px-6">
                  {error}
                </div>
              ) : null}

              <div className="border-b border-blue-100 bg-blue-50 px-5 py-3 text-xs leading-5 text-blue-700 sm:px-6">
                현재 저장된 클러스터 배정을 기준으로 체크 상태를 표시합니다.
                저장하면 선택한 목록으로 전체 교체되며, 모든 선택을 해제하면
                배정을 회수합니다.
              </div>

              <Table className="min-w-[1180px]">
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="w-[300px] px-5">계정</TableHead>
                    <TableHead className="w-[210px]">역할</TableHead>
                    <TableHead className="w-[90px]">상태</TableHead>
                    <TableHead className="w-[360px]">클러스터 배정</TableHead>
                    <TableHead className="w-[260px]">비밀번호 재설정</TableHead>
                    <TableHead className="w-[120px] pr-5 text-right">
                      작업
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <span className="inline-flex items-center gap-2 text-sm text-slate-500">
                          <Loader2 className="size-4 animate-spin" />
                          사용자 목록을 불러오는 중
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : users.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-32 text-center text-sm text-slate-500"
                      >
                        등록된 사용자가 없습니다.
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => {
                      const selectedClusterIds = normalizeClusterIds(
                        clusterSelectionByUserId[user.id] ?? [],
                      );
                      const savedClusterIds = normalizeClusterIds(
                        savedClusterIdsByUserId[user.id] ?? user.clusterIds,
                      );
                      const hasClusterChanges = !clusterIdsEqual(
                        selectedClusterIds,
                        savedClusterIds,
                      );

                      return (
                        <TableRow key={user.id}>
                          <TableCell className="px-5">
                            <div>
                              <p className="font-medium text-slate-900">
                                {user.email}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-400">
                                생성 {formatDate(user.createdAt)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge className={roleBadgeClass[user.role]}>
                                {roleLabel[user.role]}
                              </Badge>
                              <select
                                value={user.role}
                                onChange={(event) =>
                                  void handleRoleChange(
                                    user.id,
                                    event.target.value as UserRole,
                                  )
                                }
                                disabled={saving === `role-${user.id}`}
                                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus-visible:border-blue-500"
                              >
                                {roleOptions.map((role) => (
                                  <option key={role} value={role}>
                                    {role}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </TableCell>
                          <TableCell>
                            {user.disabledAt ? (
                              <Badge className="bg-rose-50 text-rose-700 ring-1 ring-rose-100">
                                비활성
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                                활성
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="w-12 shrink-0 text-[11px] font-medium text-slate-500">
                                  현재
                                </span>
                                <div className="flex min-w-0 flex-wrap gap-1.5">
                                  {savedClusterIds.length > 0 ? (
                                    savedClusterIds.map((clusterId) => (
                                      <Badge
                                        key={clusterId}
                                        className="bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                                      >
                                        {getClusterName(
                                          availableClusters,
                                          clusterId,
                                        )}
                                      </Badge>
                                    ))
                                  ) : (
                                    <Badge className="bg-amber-50 text-amber-700 ring-1 ring-amber-100">
                                      미배정
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              {clustersLoading ? (
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                  <Loader2 className="size-3.5 animate-spin" />
                                  클러스터 목록 로딩 중
                                </div>
                              ) : availableClusters.length === 0 ? (
                                <p className="text-xs text-slate-400">
                                  배정 가능한 클러스터가 없습니다.
                                </p>
                              ) : (
                                <div className="grid gap-1.5">
                                  {availableClusters.map((cluster) => {
                                    const checked = selectedClusterIds.includes(
                                      cluster.id,
                                    );

                                    return (
                                      <label
                                        key={cluster.id}
                                        className="flex h-9 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 text-xs text-slate-700"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={
                                            saving === `clusters-${user.id}`
                                          }
                                          onChange={(event) =>
                                            handleClusterSelectionChange(
                                              user.id,
                                              cluster.id,
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <Server className="size-3.5 shrink-0 text-slate-400" />
                                        <span className="truncate">
                                          {cluster.displayName} ({cluster.id})
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    clustersLoading ||
                                    saving === `clusters-${user.id}` ||
                                    !hasClusterChanges
                                  }
                                  onClick={() => void handleClusterSave(user)}
                                  className="h-8 gap-1.5"
                                >
                                  {saving === `clusters-${user.id}` ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Server className="size-3.5" />
                                  )}
                                  {hasClusterChanges ? "저장" : "저장됨"}
                                </Button>
                              </div>
                              {hasClusterChanges ? (
                                <p className="text-[11px] text-blue-700">
                                  저장되지 않은 클러스터 배정 변경이 있습니다.
                                </p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex min-w-[220px] items-center gap-2">
                              <Input
                                type="password"
                                value={passwordByUserId[user.id] ?? ""}
                                onChange={(event) =>
                                  setPasswordByUserId((current) => ({
                                    ...current,
                                    [user.id]: event.target.value,
                                  }))
                                }
                                placeholder="새 비밀번호"
                                className="h-9"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={saving === `password-${user.id}`}
                                onClick={() => void handlePasswordReset(user)}
                                className="h-9 gap-1.5"
                              >
                                <KeyRound className="size-3.5" />
                                변경
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant={
                                user.disabledAt ? "outline" : "destructive"
                              }
                              disabled={saving === `disabled-${user.id}`}
                              onClick={() => void handleDisabledToggle(user)}
                              className="h-9 gap-1.5"
                            >
                              {user.disabledAt ? (
                                <UserPlus className="size-3.5" />
                              ) : (
                                <UserMinus className="size-3.5" />
                              )}
                              {user.disabledAt ? "활성화" : "비활성화"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </section>
          </section>
        </div>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof UserCog;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between">
        <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-5 text-[13px] text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-[11px] text-slate-400">{detail}</p>
    </article>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
