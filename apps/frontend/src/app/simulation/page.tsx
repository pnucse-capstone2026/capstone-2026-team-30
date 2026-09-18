"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileCode,
  FilePlus2,
  FlaskConical,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import {
  cleanupSimulationResources,
  deploySimulation,
  fetchSimulationResources,
  fetchSimulationScenarios,
  SimulationActiveResource,
  SimulationDeployResult,
  SimulationScenario,
} from "@/lib/simulation-api";

export default function PolicySimulationPage() {
  const user = useAuthStore((state) => state.user);
  const router = useRouter();
  const liveClusters = useDataStore((state) => state.clusters);
  const fetchClusters = useDataStore((state) => state.fetchClusters);
  const globalClusterId = useDataStore((state) => state.selectedClusterId);
  const setGlobalClusterId = useDataStore(
    (state) => state.setSelectedClusterId,
  );

  const clusters = liveClusters ?? [];
  const isUnassignedUser =
    user?.role !== "ADMIN" &&
    (!user?.clusterIds ||
      user.clusterIds.length === 0 ||
      clusters.length === 0);

  const selectedClusterId = isUnassignedUser
    ? ""
    : globalClusterId ||
      user?.clusterIds?.[0] ||
      clusters?.[0]?.id ||
      (user?.role === "ADMIN" ? "default" : "");

  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    "disallow-latest-tag",
  );
  const [manifestYaml, setManifestYaml] = useState<string>("");
  const [activePods, setActivePods] = useState<SimulationActiveResource[]>([]);

  const [isLoadingScenarios, setIsLoadingScenarios] = useState<boolean>(true);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);
  const [isLoadingPods, setIsLoadingPods] = useState<boolean>(false);

  const [lastResult, setLastResult] = useState<SimulationDeployResult | null>(
    null,
  );

  useEffect(() => {
    void fetchClusters();
  }, [fetchClusters]);

  // 시나리오 목록 조회
  useEffect(() => {
    let mounted = true;
    async function loadScenarios() {
      setIsLoadingScenarios(true);
      try {
        const list = await fetchSimulationScenarios();
        if (mounted) {
          setScenarios(list);
          if (list.length > 0) {
            const initial = list[0];
            setSelectedScenarioId(initial.id);
            setManifestYaml(initial.yaml);
          }
        }
      } catch (err: any) {
        toast.error("시뮬레이션 시나리오 목록을 불러오지 못했습니다.");
      } finally {
        if (mounted) setIsLoadingScenarios(false);
      }
    }
    void loadScenarios();
    return () => {
      mounted = false;
    };
  }, []);

  // 활성 테스트 파드 목록 조회
  const loadActivePods = async () => {
    if (!selectedClusterId) {
      setActivePods([]);
      return;
    }
    setIsLoadingPods(true);
    try {
      const pods = await fetchSimulationResources(selectedClusterId);
      setActivePods(pods);
    } catch {
      // 오류 시 빈 목록 유지
    } finally {
      setIsLoadingPods(false);
    }
  };

  useEffect(() => {
    if (selectedClusterId) {
      void loadActivePods();
    }
  }, [selectedClusterId]);

  // 시나리오 선택 변경 시
  const handleSelectScenario = (scenario: SimulationScenario) => {
    setSelectedScenarioId(scenario.id);
    setManifestYaml(scenario.yaml);
    setLastResult(null);
  };

  // 시뮬레이션 배포 실행
  const handleDeploy = async () => {
    if (!selectedClusterId) {
      toast.error("테스트를 실행할 배정된 클러스터가 없습니다.");
      return;
    }
    setIsDeploying(true);
    setLastResult(null);
    try {
      const result = await deploySimulation({
        scenarioId: selectedScenarioId,
        customYaml: manifestYaml,
        namespace: "governance-testbed",
        clusterId: selectedClusterId,
      });

      setLastResult(result);

      if (result.allowed) {
        toast.success("파드가 배포되었습니다.");
      } else {
        toast.error("Kyverno 어드미션 정책에 의해 배포가 차단되었습니다.");
      }
      void loadActivePods();
    } catch (err: any) {
      toast.error(err?.message || "배포 요청 중 오류가 발생했습니다.");
    } finally {
      setIsDeploying(false);
    }
  };

  // 시뮬레이션 리소스 일괄 정리
  const handleCleanup = async () => {
    if (!selectedClusterId) return;
    if (
      !confirm("모든 테스트용 시뮬레이션 파드를 클러스터에서 정리하시겠습니까?")
    )
      return;
    setIsCleaning(true);
    try {
      const res = await cleanupSimulationResources(selectedClusterId);
      toast.success(res.message);
      void loadActivePods();
    } catch (err: any) {
      toast.error(err?.message || "리소스 정리 중 오류가 발생했습니다.");
    } finally {
      setIsCleaning(false);
    }
  };

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);

  return (
    <ProtectedRoute>
      <DashboardPageShell
        title="정책 시뮬레이션 랩"
        description="Kyverno 어드미션 차단(Enforce) 및 감사(Audit) 정책을 실시간으로 테스트하고 예외 신청 프로세스를 검증합니다."
        variant={user?.role === "ADMIN" ? "admin" : "user"}
        activeHref="/simulation"
      >
        <div className="space-y-6">
          {/* 상단 안내 배너 */}
          <div className="relative overflow-hidden rounded-2xl border border-blue-900/40 bg-gradient-to-r from-[#0b1c38] via-[#102a4e] to-[#182a4d] p-6 shadow-md text-white">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/20 p-3 text-cyan-300 shrink-0">
                  <FlaskConical className="size-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    실시간 거버넌스 샌드박스 (Live Policy Sandbox)
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-slate-200 leading-relaxed max-w-3xl">
                    사전 정의된 위반 시나리오를 배포하여 Kyverno 웹훅이 어떻게
                    위반을 감지하고 차단하는지 관찰하세요. 차단된 요청은 즉시{" "}
                    <strong>정책 예외 신청</strong>과 연동되어 승인 워크플로우를
                    진행할 수 있습니다.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {/* 대상 클러스터 선택기 */}
                <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-xl text-xs">
                  <Server className="size-3.5 text-cyan-300" />
                  <select
                    value={selectedClusterId}
                    onChange={(e) => setGlobalClusterId(e.target.value)}
                    disabled={isUnassignedUser || clusters.length === 0}
                    className="bg-transparent text-slate-100 text-xs border-none outline-none focus:ring-0 cursor-pointer"
                  >
                    {clusters.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        className="bg-slate-900 text-white"
                      >
                        {c.displayName || c.id}
                      </option>
                    ))}
                    {clusters.length === 0 && (
                      <option value="" className="bg-slate-900 text-white">
                        {isUnassignedUser ? "클러스터 배정 필요" : "default"}
                      </option>
                    )}
                  </select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCleanup}
                  disabled={
                    isCleaning || activePods.length === 0 || isUnassignedUser
                  }
                  className="gap-2 border-slate-600 bg-slate-800 text-slate-200 hover:bg-rose-950/50 hover:border-rose-500/60 hover:text-rose-200 shadow-sm"
                >
                  {isCleaning ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  테스트 리소스 일괄 정리 ({activePods.length})
                </Button>
              </div>
            </div>
          </div>

          {/* 배정된 클러스터가 없는 일반 사용자 안내 배너 */}
          {isUnassignedUser && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-amber-900 shadow-sm flex items-start gap-3">
              <ShieldAlert className="size-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">
                  배정된 Kubernetes 클러스터가 없습니다
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  정책 시뮬레이션 파드를 배포하거나 상태를 확인하려면 클러스터
                  접근 권한이 필요합니다. 플랫폼 관리자(admin)에게 계정에 대한
                  클러스터 배정을 요청하세요.
                </p>
              </div>
            </div>
          )}

          {/* 메인 영역: 좌측 시나리오 선택 + 우측 실행/결과 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* 좌측: 시나리오 목록 (5 cols) */}
            <div className="space-y-4 lg:col-span-5">
              <h3 className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                테스트 시나리오 선택
              </h3>

              {isLoadingScenarios ? (
                <div className="space-y-3">
                  <Skeleton className="h-28 w-full rounded-xl bg-slate-200" />
                  <Skeleton className="h-28 w-full rounded-xl bg-slate-200" />
                  <Skeleton className="h-28 w-full rounded-xl bg-slate-200" />
                </div>
              ) : (
                <div className="space-y-3">
                  {scenarios.map((scenario) => {
                    const isSelected = scenario.id === selectedScenarioId;
                    return (
                      <button
                        key={scenario.id}
                        type="button"
                        onClick={() => handleSelectScenario(scenario)}
                        className={`w-full text-left rounded-xl p-4 transition-all shadow-sm ${
                          isSelected
                            ? "border-2 border-cyan-600 bg-cyan-50/80 ring-1 ring-cyan-500/20"
                            : "border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {scenario.title}
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                              scenario.expectedResult === "BLOCKED"
                                ? "bg-rose-50 text-rose-700 border-rose-200"
                                : scenario.expectedResult === "AUDIT_VIOLATION"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
                            }`}
                          >
                            {scenario.expectedResult === "BLOCKED"
                              ? "차단 (Enforce)"
                              : scenario.expectedResult === "AUDIT_VIOLATION"
                                ? "감사 위반 (Audit)"
                                : "정상 준수 (Pass)"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">
                          {scenario.description}
                        </p>
                        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
                          <span>분류: {scenario.category}</span>
                          <span>•</span>
                          <span>정책: {scenario.targetPolicy}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 우측: 매니페스트 편집 및 실행 결과 (7 cols) */}
            <div className="space-y-6 lg:col-span-7">
              {/* YAML 에디터 카드 */}
              <Card className="border border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Code2 className="size-4.5 text-cyan-600" />
                      <CardTitle className="text-base font-bold text-slate-900">
                        Kubernetes 매니페스트 (Pod)
                      </CardTitle>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-slate-200 bg-slate-100 text-slate-700 font-mono text-[11px]"
                    >
                      네임스페이스: governance-testbed
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    클러스터에 실제 생성 요청할 YAML입니다. 필요에 따라 내용을
                    직접 수정하여 테스트할 수 있습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="relative rounded-xl border border-slate-800 bg-[#0c1322] font-mono text-xs shadow-inner">
                    <textarea
                      value={manifestYaml}
                      onChange={(e) => setManifestYaml(e.target.value)}
                      rows={12}
                      className="w-full resize-y bg-transparent p-4 text-slate-100 caret-cyan-400 outline-none focus:ring-1 focus:ring-cyan-500/50 leading-5"
                      spellCheck={false}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (selectedScenario)
                          setManifestYaml(selectedScenario.yaml);
                      }}
                      className="text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    >
                      <RefreshCw className="mr-1.5 size-3.5" />
                      기본 매니페스트로 초기화
                    </Button>

                    <Button
                      onClick={handleDeploy}
                      disabled={
                        isDeploying || !manifestYaml.trim() || isUnassignedUser
                      }
                      className="gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-medium shadow-sm hover:from-cyan-500 hover:to-blue-500"
                    >
                      {isDeploying ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Play className="size-4 fill-current" />
                      )}
                      시뮬레이션 배포 실행
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* 실행 결과 패널 */}
              {lastResult && (
                <div
                  className={`rounded-2xl border p-5 shadow-sm transition-all animate-in fade-in slide-in-from-top-4 ${
                    lastResult.status === "BLOCKED"
                      ? "border-rose-200 bg-rose-50/90 text-slate-900"
                      : "border-emerald-200 bg-emerald-50/90 text-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {lastResult.status === "BLOCKED" ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-100 p-2.5 text-rose-600 shrink-0">
                          <XCircle className="size-6" />
                        </div>
                      ) : (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-100 p-2.5 text-emerald-600 shrink-0">
                          <CheckCircle2 className="size-6" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h4
                            className={`text-base font-bold ${lastResult.status === "BLOCKED" ? "text-rose-950" : "text-emerald-950"}`}
                          >
                            {lastResult.status === "BLOCKED"
                              ? "배포 거부 (Admission Blocked - 403)"
                              : "배포 허용 (Admission Allowed)"}
                          </h4>
                          {lastResult.policyName && (
                            <Badge className="bg-slate-800 text-xs text-slate-100">
                              정책: {lastResult.policyName}
                            </Badge>
                          )}
                        </div>
                        <p
                          className={`mt-1 text-xs font-medium ${lastResult.status === "BLOCKED" ? "text-rose-900/90" : "text-emerald-900/90"}`}
                        >
                          {lastResult.message}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-500 shrink-0">
                      {new Date(lastResult.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* 세부 거부 사유 (Blocked인 경우) */}
                  {lastResult.blockedReason && (
                    <div className="mt-4 rounded-xl border border-slate-800 bg-[#0c1322] p-3.5 font-mono text-xs text-rose-300 shadow-inner">
                      <p className="font-semibold text-rose-400 mb-1">
                        [Kyverno 어드미션 웹훅 응답 원문]
                      </p>
                      <p className="whitespace-pre-wrap break-all leading-5">
                        {lastResult.blockedReason}
                      </p>
                    </div>
                  )}

                  {/* 예외 신청 연계 CTA */}
                  {lastResult.exceptionApplicable &&
                    lastResult.suggestedException && (
                      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-100/60 p-4 sm:flex-row sm:items-center sm:justify-between shadow-sm">
                        <div className="flex items-center gap-2 text-xs text-amber-950 font-medium">
                          <Sparkles className="size-4 text-amber-600 shrink-0" />
                          <span>
                            이 위반 리소스(
                            <strong>
                              {lastResult.suggestedException.resourceName}
                            </strong>
                            )에 대해 정책 예외를 신청하시겠습니까?
                          </span>
                        </div>
                        <Link
                          href={`/exceptions/new?policy=${encodeURIComponent(
                            lastResult.suggestedException.policyName,
                          )}&rule=${encodeURIComponent(
                            lastResult.suggestedException.ruleName || "",
                          )}&resource=${encodeURIComponent(
                            lastResult.suggestedException.resourceName,
                          )}&kind=${encodeURIComponent(
                            lastResult.suggestedException.resourceKind,
                          )}&namespace=${encodeURIComponent(
                            lastResult.suggestedException.namespace,
                          )}&cluster=default`}
                        >
                          <Button
                            size="sm"
                            className="w-full gap-2 bg-gradient-to-r from-amber-500 to-orange-500 font-semibold text-slate-950 hover:from-amber-400 hover:to-orange-400 shadow-sm sm:w-auto"
                          >
                            <FilePlus2 className="size-4" />
                            이 위반으로 예외 신청서 작성하기
                            <ArrowRight className="size-3.5" />
                          </Button>
                        </Link>
                      </div>
                    )}
                </div>
              )}

              {/* 현재 활성 테스트 파드 목록 */}
              <Card className="border border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="size-4.5 text-slate-600" />
                      <CardTitle className="text-sm font-bold text-slate-900">
                        클러스터 테스트베드 파드 현황
                      </CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadActivePods}
                      disabled={isLoadingPods}
                      className="h-8 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    >
                      <RefreshCw
                        className={`mr-1 size-3.5 ${isLoadingPods ? "animate-spin" : ""}`}
                      />
                      새로고침
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  {activePods.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      현재 배포되어 있는 시뮬레이션 파드가 없습니다.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/80">
                            <th className="py-2.5 px-3 font-semibold">
                              파드 이름
                            </th>
                            <th className="py-2.5 px-3 font-semibold">
                              네임스페이스
                            </th>
                            <th className="py-2.5 px-3 font-semibold">상태</th>
                            <th className="py-2.5 px-3 font-semibold">
                              시나리오
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {activePods.map((pod) => (
                            <tr
                              key={`${pod.namespace}-${pod.name}`}
                              className="hover:bg-slate-50/50"
                            >
                              <td className="py-2.5 px-3 font-mono text-slate-900 font-medium">
                                {pod.name}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {pod.namespace}
                              </td>
                              <td className="py-2.5 px-3">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-semibold ${
                                    pod.status === "Running"
                                      ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                                      : "border-amber-200 text-amber-700 bg-amber-50"
                                  }`}
                                >
                                  {pod.status}
                                </Badge>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {pod.scenarioId}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </DashboardPageShell>
    </ProtectedRoute>
  );
}
