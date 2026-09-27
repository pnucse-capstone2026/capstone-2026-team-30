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

import { toast } from "sonner";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [createForm, setCreateForm] = useState<CreateForm>({
    email: "",
    password: "",
    role: "REQUESTER",
  });
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);

  // 클러스터 배정 모달 상태
  const [clusterEditingUser, setClusterEditingUser] =
    useState<ManagedUser | null>(null);
  const [modalClusterIds, setModalClusterIds] = useState<string[]>([]);
  const [savingClusters, setSavingClusters] = useState(false);

  // 비밀번호 재설정 모달 상태
  const [passwordResetUser, setPasswordResetUser] =
    useState<ManagedUser | null>(null);
  const [modalPassword, setModalPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [availableClusters, setAvailableClusters] = useState<ClusterMetadata[]>(
    [],
  );
  const [clustersLoading, setClustersLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
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
      setUsers(loadedUsers);
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

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        roleLabel[u.role].toLowerCase().includes(q),
    );
  }, [users, searchQuery]);

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("create");
    setError(null);

    try {
      const user = await createUser({
        email: createForm.email,
        password: createForm.password,
        role: createForm.role,
      });
      setUsers((currentUsers) => [user, ...currentUsers]);
      setCreateForm({ email: "", password: "", role: "REQUESTER" });
      setIsCreateUserOpen(false);
      toast.success(`${user.email} 사용자를 생성했습니다.`);
    } catch (createError) {
      if (
        createError instanceof ApiError &&
        createError.code === "USER_EMAIL_ALREADY_EXISTS"
      ) {
        toast.error("이미 등록된 이메일 주소입니다.");
      } else {
        toast.error(
          createError instanceof Error
            ? createError.message
            : "사용자를 추가하지 못했습니다.",
        );
      }
    } finally {
      setSaving(null);
    }
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    setSaving(`role-${userId}`);

    try {
      const user = await updateUserRole(userId, role);
      replaceUser(user);
      toast.success(`${user.email} 역할을 ${roleLabel[role]}로 변경했습니다.`);
    } catch (roleError) {
      toast.error(
        roleError instanceof Error
          ? roleError.message
          : "역할을 변경하지 못했습니다.",
      );
    } finally {
      setSaving(null);
    }
  }

  function openPasswordModal(user: ManagedUser) {
    setPasswordResetUser(user);
    setModalPassword("");
  }

  async function handlePasswordResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordResetUser) return;
    const password = modalPassword.trim();
    if (!password) {
      toast.error("새 비밀번호를 입력해주세요.");
      return;
    }

    setSavingPassword(true);
    try {
      const updatedUser = await resetUserPassword(
        passwordResetUser.id,
        password,
      );
      replaceUser(updatedUser);
      setPasswordResetUser(null);
      toast.success(`${passwordResetUser.email} 비밀번호를 변경했습니다.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "비밀번호 변경에 실패했습니다.",
      );
    } finally {
      setSavingPassword(false);
    }
  }

  function openClusterModal(user: ManagedUser) {
    setClusterEditingUser(user);
    setModalClusterIds(normalizeClusterIds(user.clusterIds || []));
  }

  function handleModalClusterToggle(clusterId: string, checked: boolean) {
    setModalClusterIds((current) => {
      const set = new Set(current);
      if (checked) {
        set.add(clusterId);
      } else {
        set.delete(clusterId);
      }
      return Array.from(set).sort();
    });
  }

  async function handleClusterSaveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clusterEditingUser) return;

    setSavingClusters(true);
    try {
      const result = await setUserClusters(
        clusterEditingUser.id,
        modalClusterIds,
      );
      replaceUser(result);
      setClusterEditingUser(null);
      toast.success(`${clusterEditingUser.email} 클러스터 배정을 저장했습니다.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "클러스터 배정 저장에 실패했습니다.",
      );
    } finally {
      setSavingClusters(false);
    }
  }

  async function handleDisabledToggle(user: ManagedUser) {
    const disabled = !user.disabledAt;
    setSaving(`disabled-${user.id}`);

    try {
      const updatedUser = await setUserDisabled(user.id, disabled);
      replaceUser(updatedUser);
      toast.success(
        disabled
          ? `${user.email} 계정을 비활성화했습니다.`
          : `${user.email} 계정을 활성화했습니다.`,
      );
    } catch (disabledError) {
      toast.error(
        disabledError instanceof Error
          ? disabledError.message
          : "상태 변경에 실패했습니다.",
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
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-slate-200 bg-white/95 px-5 backdrop-blur-sm sm:px-8">
          <button
            type="button"
            className="mr-3 flex size-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
            aria-label="메뉴 열기"
          >
            <Menu className="size-4.5" />
          </button>
          <div>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              사용자 관리
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              계정, 권한, 클러스터 배정 및 활성 상태를 한눈에 관리합니다.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl border-slate-200 text-slate-700"
              onClick={() => void reloadPageData()}
              disabled={loading || clustersLoading}
            >
              <RefreshCw
                className={`size-3.5 ${
                  loading || clustersLoading ? "animate-spin" : ""
                }`}
              />
              새로고침
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] shadow-sm"
              onClick={() => setIsCreateUserOpen(true)}
            >
              <UserPlus className="size-3.5" />
              사용자 추가
            </Button>
          </div>
        </header>

        <div className="w-full space-y-4 p-5 sm:p-6">
          {/* 상단 컴팩트 메트릭 요약 */}
          <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <SummaryCard
              label="전체 사용자"
              value={String(users.length)}
              icon={UserCog}
              detail="등록 계정"
            />
            <SummaryCard
              label="활성 사용자"
              value={String(activeUsers)}
              icon={CheckCircle2}
              detail="정상 로그인 가능"
            />
            <SummaryCard
              label="관리자"
              value={String(
                users.filter((user) => user.role === "ADMIN").length,
              )}
              icon={ShieldCheck}
              detail="전체 관리 권한"
            />
          </section>

          {/* 메인 테이블 섹션 (한 화면 100% 가로 너비 활용) */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  계정 목록 ({filteredUsers.length}명)
                </h2>
                <p className="text-xs text-slate-500">
                  역할 변경, 클러스터 배정 및 비밀번호 재설정을 원클릭으로 처리합니다.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="search"
                  placeholder="이메일 또는 역할 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-60 rounded-xl border-slate-200 text-xs"
                />
              </div>
            </div>

            {error ? (
              <div className="border-b border-rose-100 bg-rose-50 px-5 py-2.5 text-xs text-rose-700 sm:px-6">
                {error}
              </div>
            ) : null}

            <div className="relative w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead className="w-[240px] px-5 text-xs font-semibold text-slate-600">
                      계정
                    </TableHead>
                    <TableHead className="w-[170px] text-xs font-semibold text-slate-600">
                      역할
                    </TableHead>
                    <TableHead className="w-[90px] text-xs font-semibold text-slate-600">
                      상태
                    </TableHead>
                    <TableHead className="min-w-[280px] text-xs font-semibold text-slate-600">
                      클러스터 배정
                    </TableHead>
                    <TableHead className="w-[130px] text-xs font-semibold text-slate-600 text-center">
                      보안
                    </TableHead>
                    <TableHead className="w-[110px] pr-5 text-right text-xs font-semibold text-slate-600">
                      계정 조치
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-28 text-center">
                        <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                          <Loader2 className="size-4 animate-spin" />
                          사용자 목록을 불러오는 중...
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-28 text-center text-xs text-slate-500"
                      >
                        {searchQuery ? "검색 조건에 일치하는 사용자가 없습니다." : "등록된 사용자가 없습니다."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => {
                      const userClusters = user.clusterIds || [];
                      return (
                        <TableRow key={user.id} className="hover:bg-slate-50/60">
                          <TableCell className="px-5 py-3">
                            <p className="font-medium text-xs text-slate-900">
                              {user.email}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              등록일 {formatDate(user.createdAt)}
                            </p>
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex items-center gap-1.5">
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
                                className="h-7 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] outline-none focus-visible:border-blue-500"
                              >
                                {roleOptions.map((role) => (
                                  <option key={role} value={role}>
                                    {role}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </TableCell>
                          <TableCell className="py-3">
                            {user.disabledAt ? (
                              <Badge className="bg-rose-50 text-rose-700 ring-1 ring-rose-100 text-[10px]">
                                비활성
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 text-[10px]">
                                활성
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {userClusters.length > 0 ? (
                                userClusters.map((cId) => (
                                  <Badge
                                    key={cId}
                                    className="bg-slate-100 text-slate-700 ring-1 ring-slate-200 text-[11px]"
                                  >
                                    {getClusterName(availableClusters, cId)}
                                  </Badge>
                                ))
                              ) : (
                                <Badge className="bg-amber-50 text-amber-700 ring-1 ring-amber-100 text-[11px]">
                                  미배정
                                </Badge>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openClusterModal(user)}
                                className="h-6 gap-1 px-2 text-[11px] rounded-md border-dashed text-blue-600 hover:bg-blue-50 hover:border-blue-300"
                              >
                                <Server className="size-3" />
                                배정 관리
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openPasswordModal(user)}
                              className="h-7 gap-1 px-2.5 text-xs text-slate-700 hover:bg-slate-100 rounded-lg"
                            >
                              <KeyRound className="size-3.5 text-slate-400" />
                              비밀번호 재설정
                            </Button>
                          </TableCell>
                          <TableCell className="py-3 pr-5 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant={user.disabledAt ? "outline" : "destructive"}
                              disabled={saving === `disabled-${user.id}`}
                              onClick={() => void handleDisabledToggle(user)}
                              className="h-7 gap-1 px-2.5 text-xs rounded-lg"
                            >
                              {user.disabledAt ? (
                                <>
                                  <UserPlus className="size-3" />
                                  활성화
                                </>
                              ) : (
                                <>
                                  <UserMinus className="size-3" />
                                  비활성화
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      </div>

      {/* 모달 1: 사용자 추가 다이얼로그 */}
      <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
        <DialogContent className="sm:max-w-[440px] rounded-2xl">
          <form onSubmit={handleCreateUser}>
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <UserPlus className="size-4.5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold">새 사용자 추가</DialogTitle>
                  <DialogDescription className="text-xs text-slate-500">
                    플랫폼 로그인 계정과 기본 역할을 부여합니다.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3.5 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-user-email" className="text-xs font-medium">이메일 주소</Label>
                <Input
                  id="new-user-email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                  required
                  placeholder="user@example.com"
                  className="h-9.5 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-user-password" className="text-xs font-medium">초기 비밀번호</Label>
                <Input
                  id="new-user-password"
                  type="password"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, password: e.target.value }))
                  }
                  required
                  placeholder="초기 비밀번호 입력"
                  className="h-9.5 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-user-role" className="text-xs font-medium">사용자 역할</Label>
                <select
                  id="new-user-role"
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      role: e.target.value as UserRole,
                    }))
                  }
                  className="h-9.5 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus-visible:border-blue-500"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel[role]} ({role})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateUserOpen(false)}
              >
                취소
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving === "create"}
                className="bg-[#0b2342] text-white hover:bg-[#12325b] gap-1.5"
              >
                {saving === "create" && <Loader2 className="size-3.5 animate-spin" />}
                계정 생성
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 모달 2: 클러스터 배정 관리 다이얼로그 */}
      <Dialog
        open={clusterEditingUser !== null}
        onOpenChange={(open) => !open && setClusterEditingUser(null)}
      >
        <DialogContent className="sm:max-w-[480px] rounded-2xl">
          <form onSubmit={handleClusterSaveSubmit}>
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Server className="size-4.5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold">클러스터 배정 관리</DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 font-mono truncate max-w-sm">
                    {clusterEditingUser?.email}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3 py-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                사용자가 정책 위반 조회 및 시뮬레이션을 수행할 수 있는 대상 클러스터를 선택합니다.
              </p>

              {clustersLoading ? (
                <div className="flex items-center justify-center py-6 text-xs text-slate-400">
                  <Loader2 className="size-4 animate-spin mr-2" />
                  클러스터 목록 로딩 중...
                </div>
              ) : availableClusters.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  등록된 클러스터가 없습니다.
                </p>
              ) : (
                <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                  {availableClusters.map((cluster) => {
                    const checked = modalClusterIds.includes(cluster.id);
                    return (
                      <label
                        key={cluster.id}
                        className={`flex items-center gap-3 rounded-xl border p-2.5 text-xs transition-colors cursor-pointer ${
                          checked
                            ? "border-blue-200 bg-blue-50/60 text-blue-900 font-medium"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            handleModalClusterToggle(cluster.id, e.target.checked)
                          }
                          className="size-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                        <Server className="size-4 text-slate-400 shrink-0" />
                        <span className="flex-1 truncate">
                          {cluster.displayName} ({cluster.id})
                        </span>
                        {checked && (
                          <Badge className="bg-blue-100 text-blue-700 text-[10px] border-none">
                            배정됨
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setClusterEditingUser(null)}
              >
                취소
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={savingClusters}
                className="bg-[#0b2342] text-white hover:bg-[#12325b] gap-1.5"
              >
                {savingClusters && <Loader2 className="size-3.5 animate-spin" />}
                배정 저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 모달 3: 비밀번호 재설정 다이얼로그 */}
      <Dialog
        open={passwordResetUser !== null}
        onOpenChange={(open) => !open && setPasswordResetUser(null)}
      >
        <DialogContent className="sm:max-w-[400px] rounded-2xl">
          <form onSubmit={handlePasswordResetSubmit}>
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <KeyRound className="size-4.5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold">비밀번호 재설정</DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 font-mono truncate max-w-xs">
                    {passwordResetUser?.email}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-new-password" className="text-xs font-medium">새 비밀번호</Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  value={modalPassword}
                  onChange={(e) => setModalPassword(e.target.value)}
                  placeholder="새 비밀번호 입력"
                  required
                  className="h-9.5 text-xs"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPasswordResetUser(null)}
              >
                취소
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={savingPassword}
                className="bg-amber-600 text-white hover:bg-amber-700 gap-1.5"
              >
                {savingPassword && <Loader2 className="size-3.5 animate-spin" />}
                비밀번호 변경
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>
      </div>
      <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shrink-0">
        <Icon className="size-5" />
      </div>
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

