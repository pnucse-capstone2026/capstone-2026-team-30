"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FilePlus2,
  FlaskConical,
  HelpCircle,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
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
import {
  explainKyvernoError,
  ExplainKyvernoErrorResponse,
} from "@/lib/ai-agent-api";

export default function PolicySimulationAndDiagnosticsPage() {
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

  // 시뮬레이션 시나리오 및 에디터 상태
  const [scenarios, setScenarios] = useState<SimulationScenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    "disallow-latest-tag",
  );
  const [manifestYaml, setManifestYaml] = useState<string>("");
  const [optionalErrorMsg, setOptionalErrorMsg] = useState<string>("");
  const [showErrorInput, setShowErrorInput] = useState<boolean>(false);
  const [activePods, setActivePods] = useState<SimulationActiveResource[]>([]);

  // 로딩 상태
  const [isLoadingScenarios, setIsLoadingScenarios] = useState<boolean>(true);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);
  const [isLoadingPods, setIsLoadingPods] = useState<boolean>(false);

  // 결과 상태
  const [deployResult, setDeployResult] =
    useState<SimulationDeployResult | null>(null);
  const [diagnosticResult, setDiagnosticResult] =
    useState<ExplainKyvernoErrorResponse | null>(null);
  const [copiedFix, setCopiedFix] = useState<boolean>(false);

  // 매니페스트 내용에서 namespace 자동 감지
  const detectedNamespace = useMemo(() => {
    const match = manifestYaml.match(/namespace:\s*([a-zA-Z0-9_-]+)/);
    return match ? match[1] : "default";
  }, [manifestYaml]);

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
  const loadActivePods = useCallback(async () => {
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
  }, [selectedClusterId]);

  useEffect(() => {
    if (selectedClusterId) {
      void loadActivePods();
    }
  }, [selectedClusterId, loadActivePods]);

  // 거버넌스 시나리오 선택 핸들러
  const handleSelectScenario = (scenario: SimulationScenario) => {
    setSelectedScenarioId(scenario.id);
    setManifestYaml(scenario.yaml);
    setOptionalErrorMsg("");
    setDeployResult(null);
    setDiagnosticResult(null);
  };

  // 1. AI 거버넌스 사전 진단 (Fast-Fail & Dry-Run 선검증)
  const handleDiagnose = async () => {
    if (!manifestYaml.trim()) {
      toast.error("진단할 Kubernetes 매니페스트 YAML을 입력하세요.");
      return;
    }

    setIsDiagnosing(true);
    setDiagnosticResult(null);
    setDeployResult(null);

    try {
      const res = await explainKyvernoError({
        errorMessage: optionalErrorMsg.trim() || undefined,
        resourceManifest: manifestYaml,
        clusterId: selectedClusterId || undefined,
        namespace: detectedNamespace,
      });

      setDiagnosticResult(res);

      if (res.isCompliant || res.status === "COMPLIANT") {
        toast.success("거버넌스 정책 준수 확인: 배포 준비가 완료되었습니다.");
      } else {
        toast.warning("Kyverno 정책 차단 요인이 감지되었습니다.");
      }
    } catch (err: any) {
      toast.error(err?.message || "AI 정책 진단 중 오류가 발생했습니다.");
    } finally {
      setIsDiagnosing(false);
    }
  };

  // 2. 클러스터 시뮬레이션 배포 실행
  const handleDeploy = async () => {
    if (!selectedClusterId) {
      toast.error("테스트를 실행할 배정된 클러스터가 없습니다.");
      return;
    }
    setIsDeploying(true);
    setDeployResult(null);

    try {
      const result = await deploySimulation({
        scenarioId: selectedScenarioId,
        customYaml: manifestYaml,
        namespace: detectedNamespace,
        clusterId: selectedClusterId,
      });

      setDeployResult(result);

      if (result.status === "ALLOWED") {
        toast.success("파드가 성공적으로 배포되었습니다.");
      } else if (result.status === "BLOCKED") {
        toast.error("Kyverno 어드미션 정책에 의해 배포가 차단되었습니다.");
      } else {
        toast.error(result.message || "배포 중 인프라 오류가 발생했습니다.");
      }
      void loadActivePods();
    } catch (err: any) {
      toast.error(err?.message || "배포 요청 중 오류가 발생했습니다.");
    } finally {
      setIsDeploying(false);
    }
  };

  // AI 권장 수정본을 에디터에 즉시 반영
  const handleApplySuggestedFix = (suggestedYaml: string) => {
    setManifestYaml(suggestedYaml);
    setDiagnosticResult(null);
    setDeployResult(null);
    toast.success(
      "AI 권장 수정 YAML이 에디터에 적용되었습니다. 재검증 또는 배포를 진행하세요.",
    );
  };

  // 수정 YAML 클립보드 복사
  const handleCopyFix = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedFix(true);
      toast.success("수정 매니페스트가 클립보드에 복사되었습니다.");
      setTimeout(() => setCopiedFix(false), 2000);
    } catch {
      toast.error("클립보드 복사에 실패했습니다.");
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
        title="정책 시뮬레이션 & AI 진단 랩"
        description="Kubernetes 매니페스트의 Kyverno 거버넌스 정책 준수 여부를 사전 진단(Fast-Fail & Dry-Run)하고, 실시간 클러스터 배포 시뮬레이션 및 AI 자동 교정을 수행합니다."
        variant={user?.role === "ADMIN" ? "admin" : "user"}
        activeHref="/simulation"
      >
        <div className="space-y-6">
          {/* 상단 통합 안내 배너 */}
          <div className="relative overflow-hidden rounded-2xl border border-blue-900/40 bg-gradient-to-r from-[#0b1c38] via-[#102a4e] to-[#182a4d] p-6 shadow-md text-white">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/20 p-3 text-cyan-300 shrink-0">
                  <FlaskConical className="size-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white">
                      통합 거버넌스 샌드박스 (Policy Sandbox & AI Diagnostics)
                    </h2>
                    <Badge className="bg-gradient-to-r from-purple-500 to-indigo-500 text-white border-none text-[10px] font-semibold">
                      Fast-Fail & AI 검증
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs sm:text-sm text-slate-200 leading-relaxed max-w-3xl">
                    매니페스트를 입력하여{" "}
                    <strong>[AI 사전 거버넌스 진단]</strong>으로 정책 준수
                    상태를 즉시 판별하거나,{" "}
                    <strong>[클러스터 시뮬레이션 배포]</strong>로 실제 Kyverno
                    웹훅 차단 및 정책 예외 신청 워크플로우를 실시간 검증하세요.
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
                  테스트 파드 정리 ({activePods.length})
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

          {/* 메인 2열 그리드: 좌측 시나리오/프리셋 + 우측 편집/실행/결과 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* 좌측: 거버넌스 검증 시나리오 목록 패널 (5 cols) */}
            <div className="space-y-4 lg:col-span-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    거버넌스 검증 시나리오 ({scenarios.length})
                  </span>
                </div>
              </div>

              {isLoadingScenarios ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full rounded-xl bg-slate-200" />
                  <Skeleton className="h-24 w-full rounded-xl bg-slate-200" />
                  <Skeleton className="h-24 w-full rounded-xl bg-slate-200" />
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
                        className={`w-full text-left rounded-xl p-3.5 transition-all shadow-sm ${
                          isSelected
                            ? "border-2 border-cyan-600 bg-cyan-50/80 ring-1 ring-cyan-500/20"
                            : "border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900">
                            {scenario.title}
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
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
                                ? "감사 (Audit)"
                                : "준수 (Pass)"}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
                          {scenario.description}
                        </p>
                        <div className="mt-2.5 flex items-center gap-2 text-[10px] text-slate-400">
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

            {/* 우측: YAML 에디터 및 진단/배포 실행 영역 (7 cols) */}
            <div className="space-y-6 lg:col-span-7">
              {/* YAML 에디터 카드 */}
              <Card className="border border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Code2 className="size-4.5 text-cyan-600" />
                      <CardTitle className="text-sm font-bold text-slate-900">
                        Kubernetes 매니페스트 (YAML)
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="border-slate-200 bg-slate-100 text-slate-700 font-mono text-[11px]"
                      >
                        타겟 네임스페이스: {detectedNamespace}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    클러스터에 배포하거나 정책 준수 여부를 사전 점검할
                    매니페스트입니다. YAML 내부에서 namespace나 spec을 자유롭게
                    수정할 수 있습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-3">
                  <div className="relative rounded-xl border border-slate-800 bg-[#0c1322] font-mono text-xs shadow-inner">
                    <textarea
                      value={manifestYaml}
                      onChange={(e) => setManifestYaml(e.target.value)}
                      rows={11}
                      className="w-full resize-y bg-transparent p-3.5 text-slate-100 caret-cyan-400 outline-none focus:ring-1 focus:ring-cyan-500/50 leading-5"
                      spellCheck={false}
                    />
                  </div>

                  {/* 선택 사항: kubectl 실패 에러 메시지 첨부 토글 */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowErrorInput(!showErrorInput)}
                      className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-indigo-600 font-medium transition-colors"
                    >
                      <HelpCircle className="size-3.5 text-amber-500" />
                      <span>
                        {showErrorInput
                          ? "실패 에러 메시지 입력 접기"
                          : "실패 에러 메시지가 있다면 함께 입력하기 (선택 사항)"}
                      </span>
                    </button>

                    {showErrorInput && (
                      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1.5 animate-in fade-in duration-200">
                        <label className="text-[11px] font-semibold text-slate-700 flex items-center justify-between">
                          <span>터미널/CI에서 발생한 에러 메시지 (선택)</span>
                          {optionalErrorMsg && (
                            <button
                              type="button"
                              onClick={() => setOptionalErrorMsg("")}
                              className="text-[10px] text-rose-600 hover:underline"
                            >
                              지우기
                            </button>
                          )}
                        </label>
                        <textarea
                          value={optionalErrorMsg}
                          onChange={(e) => setOptionalErrorMsg(e.target.value)}
                          rows={3}
                          placeholder="Error from server (Forbidden): admission webhook denied the request..."
                          className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs font-mono text-slate-800 outline-none focus:border-indigo-500 leading-4"
                          spellCheck={false}
                        />
                      </div>
                    )}
                  </div>

                  {/* 하단 액션 버튼 그룹 */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (selectedScenario)
                          setManifestYaml(selectedScenario.yaml);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      <RefreshCw className="mr-1.5 size-3.5" />
                      매니페스트 초기화
                    </Button>

                    <div className="flex items-center gap-2.5 w-full sm:w-auto">
                      {/* 액션 1: AI 사전 거버넌스 진단 */}
                      <Button
                        onClick={handleDiagnose}
                        disabled={isDiagnosing || !manifestYaml.trim()}
                        className="flex-1 sm:flex-none gap-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-white font-medium shadow-sm hover:from-indigo-500 hover:to-purple-500 text-xs h-9"
                      >
                        {isDiagnosing ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            AI 사전 진단 중...
                          </>
                        ) : (
                          <>
                            <Sparkles className="size-3.5" />
                            AI 사전 거버넌스 진단
                          </>
                        )}
                      </Button>

                      {/* 액션 2: 클러스터 시뮬레이션 배포 */}
                      <Button
                        onClick={handleDeploy}
                        disabled={
                          isDeploying ||
                          !manifestYaml.trim() ||
                          isUnassignedUser
                        }
                        className="flex-1 sm:flex-none gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-medium shadow-sm hover:from-cyan-500 hover:to-blue-500 text-xs h-9"
                      >
                        {isDeploying ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            배포 실행 중...
                          </>
                        ) : (
                          <>
                            <Play className="size-3.5 fill-current" />
                            클러스터 시뮬레이션 배포
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 1. AI 사전 거버넌스 진단 결과 렌더링 */}
              {diagnosticResult && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-3">
                  {/* Case A: COMPLIANT (정상 준수 완료) */}
                  {(diagnosticResult.isCompliant ||
                    diagnosticResult.status === "COMPLIANT") && (
                    <Card className="border border-emerald-300 bg-white shadow-sm overflow-hidden">
                      <CardHeader className="border-b border-emerald-100 pb-3.5 bg-emerald-50/70">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="rounded-full bg-emerald-100 p-1.5 text-emerald-700 border border-emerald-300">
                              <CheckCircle2 className="size-5" />
                            </div>
                            <div>
                              <CardTitle className="text-sm font-bold text-emerald-950">
                                Kyverno 거버넌스 정책 준수 완료 (Ready to
                                Deploy)
                              </CardTitle>
                              <p className="text-[11px] text-emerald-800 mt-0.5">
                                정책 위반이나 배포 차단 요인을 발견하지
                                못했습니다. 클러스터 기준을 충족합니다.
                              </p>
                            </div>
                          </div>
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] font-semibold">
                            {diagnosticResult.provider ===
                            "FAST_FAIL_PRE_VALIDATION"
                              ? "Fast-Fail 검증 완료"
                              : `${diagnosticResult.provider || "AI"} 검증 완료`}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-4">
                        <p className="text-xs leading-relaxed text-slate-800 font-medium">
                          {diagnosticResult.summary}
                        </p>

                        {/* 정책 체크리스트 항목 */}
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 space-y-2">
                          <span className="text-[11px] font-bold text-emerald-900 flex items-center gap-1.5">
                            <ShieldCheck className="size-4 text-emerald-600" />
                            검증 통과 거버넌스 표준:
                          </span>
                          <ul className="space-y-1.5 text-xs text-slate-700">
                            {(diagnosticResult.passedRules &&
                            diagnosticResult.passedRules.length > 0
                              ? diagnosticResult.passedRules
                              : [
                                  "disallow-latest-tag: 명시적 버전 태그 또는 digest 사용 준수",
                                  "require-labels: 필수 식별 레이블(app.kubernetes.io/name, team) 설정 완료",
                                  "require-resource-limits: CPU 및 메모리 상한선(limits) 및 요청량 정의 완료",
                                  "disallow-privileged-containers: 비특권(Non-privileged) 보안 격리 모드 준수",
                                ]
                            ).map((rule, idx) => (
                              <li
                                key={idx}
                                className="flex items-center gap-2 text-[11px]"
                              >
                                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                                  ✓
                                </span>
                                <span>{rule}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* 즉시 배포 바로가기 CTA */}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xs text-slate-500">
                            이 매니페스트는 안전하며 클러스터에 바로 생성할 수
                            있습니다.
                          </span>
                          <Button
                            onClick={handleDeploy}
                            disabled={isDeploying || isUnassignedUser}
                            size="sm"
                            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium shadow-sm hover:from-emerald-500 hover:to-teal-500 text-xs"
                          >
                            {isDeploying ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Play className="size-3.5 fill-current" />
                            )}
                            클러스터에 실제 배포하기
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Case B: BLOCKED (정책 차단/위반 감지) */}
                  {!diagnosticResult.isCompliant &&
                    diagnosticResult.status !== "COMPLIANT" &&
                    diagnosticResult.status !== "ERROR" && (
                      <Card className="border border-rose-200 bg-white shadow-sm overflow-hidden">
                        <CardHeader className="border-b border-rose-100 pb-3.5 bg-rose-50/70">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="rounded-full bg-rose-100 p-1.5 text-rose-700 border border-rose-300">
                                <ShieldAlert className="size-5" />
                              </div>
                              <div>
                                <CardTitle className="text-sm font-bold text-rose-950">
                                  Kyverno 어드미션 차단 요인 감지 (Admission
                                  Blocked)
                                </CardTitle>
                                <p className="text-[11px] text-rose-800 mt-0.5">
                                  클러스터 거버넌스 정책에 위배되는 설정이
                                  발견되었습니다.
                                </p>
                              </div>
                            </div>
                            <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10px] font-semibold">
                              {diagnosticResult.provider || "AI 진단"}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-4 space-y-4">
                          <p className="text-xs leading-relaxed text-slate-800 font-medium">
                            {diagnosticResult.summary}
                          </p>

                          {/* 거버넌스 도입 배경 */}
                          {diagnosticResult.governanceRationale && (
                            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-950">
                              <div className="flex items-center gap-1.5 font-bold text-indigo-900 mb-1">
                                <Info className="size-3.5" />
                                <span>사내 거버넌스 규격 및 도입 배경</span>
                              </div>
                              <p className="text-slate-700 leading-relaxed text-[11px]">
                                {diagnosticResult.governanceRationale}
                              </p>
                            </div>
                          )}

                          {/* 단계별 해결 가이드 */}
                          {diagnosticResult.resolutionSteps &&
                            diagnosticResult.resolutionSteps.length > 0 && (
                              <div className="space-y-2">
                                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                  <CheckCircle2 className="size-4 text-emerald-600" />
                                  단계별 해결 조치 방법
                                </span>
                                <ul className="space-y-2">
                                  {diagnosticResult.resolutionSteps.map(
                                    (step, idx) => (
                                      <li
                                        key={idx}
                                        className="flex items-start gap-2.5 text-xs text-slate-700"
                                      >
                                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                                          {idx + 1}
                                        </span>
                                        <span className="leading-5">
                                          {step}
                                        </span>
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}

                          {/* AI 권장 수정 YAML */}
                          {diagnosticResult.suggestedFixYaml && (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                                  <Sparkles className="size-4 text-emerald-600" />
                                  AI 권장 수정 매니페스트 (Compliant Code)
                                </span>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleCopyFix(
                                        diagnosticResult.suggestedFixYaml!,
                                      )
                                    }
                                    className="h-7 text-xs border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50 gap-1"
                                  >
                                    {copiedFix ? (
                                      <>
                                        <Check className="size-3 text-emerald-600" />
                                        복사 완료
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="size-3" />
                                        복사
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      handleApplySuggestedFix(
                                        diagnosticResult.suggestedFixYaml!,
                                      )
                                    }
                                    className="h-7 text-xs bg-emerald-600 text-white hover:bg-emerald-500 gap-1 shadow-sm"
                                  >
                                    <Wand2 className="size-3" />
                                    에디터에 바로 적용
                                  </Button>
                                </div>
                              </div>
                              <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0c1322] p-3 font-mono text-[11px] text-emerald-300 leading-5">
                                {diagnosticResult.suggestedFixYaml}
                              </pre>
                            </div>
                          )}

                          {/* 정책 예외 신청 바로가기 */}
                          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="flex items-center gap-2 text-xs text-amber-950 font-medium">
                              <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                              <span>
                                업무 특성상 수정이 불가능하여 정책 예외가
                                필요하신가요?
                              </span>
                            </div>
                            <Link
                              href={
                                user?.role === "ADMIN"
                                  ? "/admin/exceptions/new"
                                  : "/exceptions/new"
                              }
                            >
                              <Button
                                size="sm"
                                className="w-full sm:w-auto gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 font-semibold text-slate-950 hover:from-amber-400 hover:to-orange-400 text-xs shadow-sm"
                              >
                                <FilePlus2 className="size-3.5" />
                                정책 예외 신청서 작성
                                <ArrowRight className="size-3" />
                              </Button>
                            </Link>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                  {/* Case C: ERROR (네임스페이스 부재 또는 API 오류) */}
                  {diagnosticResult.status === "ERROR" && (
                    <Card className="border border-amber-300 bg-white shadow-sm overflow-hidden">
                      <CardHeader className="border-b border-amber-100 pb-3 bg-amber-50/70">
                        <div className="flex items-center gap-2.5">
                          <AlertTriangle className="size-5 text-amber-600" />
                          <CardTitle className="text-sm font-bold text-amber-950">
                            클러스터 인프라/환경 요인에 의한 오류
                          </CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-3">
                        <p className="text-xs leading-relaxed text-slate-800">
                          {diagnosticResult.summary}
                        </p>
                        {diagnosticResult.resolutionSteps && (
                          <ul className="space-y-1.5 text-xs text-slate-700">
                            {diagnosticResult.resolutionSteps.map(
                              (step, idx) => (
                                <li
                                  key={idx}
                                  className="flex items-center gap-2"
                                >
                                  <span className="text-amber-600">•</span>
                                  <span>{step}</span>
                                </li>
                              ),
                            )}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* 2. 클러스터 시뮬레이션 배포 결과 패널 */}
              {deployResult && (
                <div
                  className={`rounded-2xl border p-5 shadow-sm transition-all animate-in fade-in slide-in-from-top-4 ${
                    deployResult.status === "BLOCKED"
                      ? "border-rose-200 bg-rose-50/90 text-slate-900"
                      : deployResult.status === "ALLOWED"
                        ? "border-emerald-200 bg-emerald-50/90 text-slate-900"
                        : "border-amber-200 bg-amber-50/90 text-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {deployResult.status === "BLOCKED" ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-100 p-2.5 text-rose-600 shrink-0">
                          <XCircle className="size-6" />
                        </div>
                      ) : deployResult.status === "ALLOWED" ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-100 p-2.5 text-emerald-600 shrink-0">
                          <CheckCircle2 className="size-6" />
                        </div>
                      ) : (
                        <div className="rounded-xl border border-amber-200 bg-amber-100 p-2.5 text-amber-600 shrink-0">
                          <AlertTriangle className="size-6" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h4
                            className={`text-base font-bold ${
                              deployResult.status === "BLOCKED"
                                ? "text-rose-950"
                                : deployResult.status === "ALLOWED"
                                  ? "text-emerald-950"
                                  : "text-amber-950"
                            }`}
                          >
                            {deployResult.status === "BLOCKED"
                              ? "배포 거부 (Admission Blocked - 403)"
                              : deployResult.status === "ALLOWED"
                                ? "배포 허용 (Admission Allowed)"
                                : "배포 요청 오류 (API Error)"}
                          </h4>
                          {deployResult.policyName && (
                            <Badge className="bg-slate-800 text-xs text-slate-100">
                              정책: {deployResult.policyName}
                            </Badge>
                          )}
                        </div>
                        <p
                          className={`mt-1 text-xs font-medium ${
                            deployResult.status === "BLOCKED"
                              ? "text-rose-900/90"
                              : deployResult.status === "ALLOWED"
                                ? "text-emerald-900/90"
                                : "text-amber-900/90"
                          }`}
                        >
                          {deployResult.message}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-500 shrink-0">
                      {new Date(deployResult.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* 세부 거부 사유 (Blocked인 경우) */}
                  {deployResult.blockedReason && (
                    <div className="mt-4 rounded-xl border border-slate-800 bg-[#0c1322] p-3.5 font-mono text-xs text-rose-300 shadow-inner">
                      <p className="font-semibold text-rose-400 mb-1">
                        [Kyverno 어드미션 웹훅 응답 원문]
                      </p>
                      <p className="whitespace-pre-wrap break-all leading-5">
                        {deployResult.blockedReason}
                      </p>
                    </div>
                  )}

                  {/* 차단 시 AI 심층 진단 바로가기 버튼 */}
                  {deployResult.status === "BLOCKED" && !diagnosticResult && (
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleDiagnose}
                        disabled={isDiagnosing}
                        className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                      >
                        <Sparkles className="size-3.5" />이 차단 사유로 AI 정밀
                        진단 및 수정안 받기
                      </Button>
                    </div>
                  )}

                  {/* 예외 신청 연계 CTA */}
                  {deployResult.exceptionApplicable &&
                    deployResult.suggestedException && (
                      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-100/60 p-4 sm:flex-row sm:items-center sm:justify-between shadow-sm">
                        <div className="flex items-center gap-2 text-xs text-amber-950 font-medium">
                          <Sparkles className="size-4 text-amber-600 shrink-0" />
                          <span>
                            이 위반 리소스(
                            <strong>
                              {deployResult.suggestedException.resourceName}
                            </strong>
                            )에 대해 정책 예외를 신청하시겠습니까?
                          </span>
                        </div>
                        <Link
                          href={`/exceptions/new?policy=${encodeURIComponent(
                            deployResult.suggestedException.policyName,
                          )}&rule=${encodeURIComponent(
                            deployResult.suggestedException.ruleName || "",
                          )}&resource=${encodeURIComponent(
                            deployResult.suggestedException.resourceName,
                          )}&kind=${encodeURIComponent(
                            deployResult.suggestedException.resourceKind,
                          )}&namespace=${encodeURIComponent(
                            deployResult.suggestedException.namespace,
                          )}&cluster=default`}
                        >
                          <Button
                            size="sm"
                            className="w-full gap-2 bg-gradient-to-r from-amber-500 to-orange-500 font-semibold text-slate-950 hover:from-amber-400 hover:to-orange-400 shadow-sm sm:w-auto text-xs"
                          >
                            <FilePlus2 className="size-3.5" />
                            이 위반으로 예외 신청서 작성하기
                            <ArrowRight className="size-3" />
                          </Button>
                        </Link>
                      </div>
                    )}
                </div>
              )}

              {/* 현재 활성 테스트 파드 목록 */}
              <Card className="border border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-3">
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
                <CardContent className="pt-3">
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
