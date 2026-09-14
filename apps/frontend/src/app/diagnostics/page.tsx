"use client";

import { useState } from "react";
import Link from "next/link";
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
  ShieldAlert,
  Sparkles,
  Zap,
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
import { useAuthStore } from "@/lib/auth-store";
import {
  explainKyvernoError,
  ExplainKyvernoErrorResponse,
} from "@/lib/ai-agent-api";

// 빠른 테스트를 위한 Enforce 차단 대표 샘플 매니페스트
const PRESET_SAMPLES = [
  {
    id: "latest-tag",
    title: "1. :latest 태그 사용 차단",
    policy: "disallow-latest-tag",
    error: `Error from server (Forbidden): error when creating "pod.yaml": admission webhook "validate.kyverno.svc-fail" denied the request: 

resource Pod/default/sample-latest-pod was blocked due to the following policies 

disallow-latest-tag:
  disallow-latest-tag: 'validation error: Using a :latest tag is prohibited. A specific image tag or digest must be used. rule disallow-latest-tag failed at path /spec/containers/0/image/'`,
    yaml: `apiVersion: v1
kind: Pod
metadata:
  name: sample-latest-pod
  namespace: default
spec:
  containers:
    - name: web-server
      image: nginx:latest
      resources:
        limits:
          cpu: 100m
          memory: 128Mi
`,
  },
  {
    id: "privileged",
    title: "2. 특권(Privileged) 컨테이너 차단",
    policy: "disallow-privileged-containers",
    error: `Error from server (Forbidden): error when creating "pod.yaml": admission webhook "validate.kyverno.svc-fail" denied the request: 

resource Pod/default/sample-priv-pod was blocked due to the following policies 

disallow-privileged-containers:
  privileged-containers: 'validation error: Privileged mode is not allowed. rule privileged-containers failed at path /spec/containers/0/securityContext/privileged/'`,
    yaml: `apiVersion: v1
kind: Pod
metadata:
  name: sample-priv-pod
  namespace: default
spec:
  containers:
    - name: system-tool
      image: registry.k8s.io/pause:3.10
      securityContext:
        privileged: true
      resources:
        limits:
          cpu: 50m
          memory: 64Mi
`,
  },
  {
    id: "registry",
    title: "3. 미승인 외부 레지스트리 차단",
    policy: "restrict-image-registries",
    error: `Error from server (Forbidden): error when creating "pod.yaml": admission webhook "validate.kyverno.svc-fail" denied the request: 

resource Pod/default/sample-registry-pod was blocked due to the following policies 

restrict-image-registries:
  validate-registries: 'validation error: Unknown image registry "docker.io/unverified/app:1.0.0". Only authorized corporate registries are permitted.'`,
    yaml: `apiVersion: v1
kind: Pod
metadata:
  name: sample-registry-pod
  namespace: default
spec:
  containers:
    - name: unapproved-app
      image: docker.io/unverified/app:1.0.0
      resources:
        limits:
          cpu: 100m
          memory: 128Mi
`,
  },
];

export default function EnforceDiagnosticsPage() {
  const user = useAuthStore((state) => state.user);
  const sidebarVariant = user?.role === "ADMIN" ? "admin" : "user";

  const [manifestYaml, setManifestYaml] = useState<string>(
    PRESET_SAMPLES[0].yaml,
  );
  const [errorMessage, setErrorMessage] = useState<string>(
    PRESET_SAMPLES[0].error,
  );
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);
  const [copiedFix, setCopiedFix] = useState<boolean>(false);
  const [result, setResult] = useState<ExplainKyvernoErrorResponse | null>(
    null,
  );

  // 샘플 프리셋 적용
  const handleSelectPreset = (preset: (typeof PRESET_SAMPLES)[number]) => {
    setManifestYaml(preset.yaml);
    setErrorMessage(preset.error);
    setResult(null);
    toast.info(`"${preset.title}" 샘플이 로드되었습니다.`);
  };

  // AI 진단 실행
  const handleDiagnose = async () => {
    if (!manifestYaml.trim()) {
      toast.error("진단할 Kubernetes 매니페스트 YAML을 입력하세요.");
      return;
    }

    setIsDiagnosing(true);
    setResult(null);
    try {
      const payloadErrorMessage =
        errorMessage.trim() ||
        "Kyverno admission webhook denied the deployment request (HTTP 403 Forbidden). No PolicyReport was generated because the resource was blocked at admission time.";

      const res = await explainKyvernoError({
        errorMessage: payloadErrorMessage,
        resourceManifest: manifestYaml,
        clusterContext:
          "Mode: Enforce, Namespace: user-workspace, AdmissionWebhooks: Enabled",
      });

      setResult(res);
      toast.success("AI 진단 리포트가 성공적으로 생성되었습니다.");
    } catch (err: any) {
      toast.error(err?.message || "AI 진단 요청 중 오류가 발생했습니다.");
    } finally {
      setIsDiagnosing(false);
    }
  };

  // 수정 YAML 클립보드 복사
  const handleCopyFix = async () => {
    if (!result?.suggestedFixYaml) return;
    try {
      await navigator.clipboard.writeText(result.suggestedFixYaml);
      setCopiedFix(true);
      toast.success("수정된 YAML이 클립보드에 복사되었습니다.");
      setTimeout(() => setCopiedFix(false), 2000);
    } catch {
      toast.error("클립보드 복사에 실패했습니다.");
    }
  };

  return (
    <ProtectedRoute>
      <DashboardPageShell
        title="Enforce 차단 매니페스트 AI 진단"
        description="Enforce 정책으로 인해 입구(Admission)에서 거부되어 PolicyReport가 생성되지 않는 매니페스트의 원인을 규명하고 즉시 통과 가능한 수정안을 제공합니다."
        variant={sidebarVariant}
        activeHref="/diagnostics"
      >
        <div className="space-y-6">
          {/* 핵심 개념 안내 배너: 왜 PolicyReport가 생성되지 않는가? */}
          <div className="relative overflow-hidden rounded-2xl border border-indigo-900/40 bg-gradient-to-r from-[#0e172e] via-[#141b3a] to-[#1c183b] p-6 shadow-md text-white">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-xl border border-rose-400/40 bg-rose-500/20 p-3 text-rose-300 shrink-0">
                  <ShieldAlert className="size-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-bold text-white">
                      왜 대시보드 위반 목록(PolicyReport)에 나타나지 않나요?
                    </h2>
                    <Badge
                      variant="outline"
                      className="border-rose-400/40 bg-rose-500/20 text-rose-200 text-[10px] font-semibold"
                    >
                      Enforce 차단 특성
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-slate-200 max-w-4xl">
                    Kyverno의 <strong>Audit(감사)</strong> 모드는 파드가 정상
                    생성된 후 백그라운드에서 감시하여 위반 보고서(
                    <code>PolicyReport</code>)를 남기지만,{" "}
                    <strong>Enforce(강제 차단)</strong> 모드는 K8s 어드미션 웹훅
                    단계에서 배포 요청 자체를{" "}
                    <strong>HTTP 403으로 원천 차단</strong>합니다. 따라서
                    클러스터 내에 파드가 존재하지 않으므로{" "}
                    <code>PolicyReport</code> 또한 전혀 생성되지 않습니다.
                  </p>
                  <p className="mt-2 text-xs sm:text-sm text-cyan-300 font-medium">
                    👉 아래에 실패한 매니페스트 YAML을 입력하시면, 어떤 Enforce
                    정책에 의해 차단되었는지 AI가 분석하여 즉시 배포 가능한
                    수정안을 안내해 드립니다.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 샘플 프리셋 선택 바 */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-semibold text-slate-600 mr-1 flex items-center gap-1.5">
              <Zap className="size-3.5 text-amber-500" />
              자주 발생하는 Enforce 차단 예시:
            </span>
            {PRESET_SAMPLES.map((preset) => (
              <Button
                key={preset.id}
                variant="outline"
                size="sm"
                onClick={() => handleSelectPreset(preset)}
                className="h-8 text-xs border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/50 hover:text-indigo-700 shadow-sm font-medium"
              >
                {preset.title}
              </Button>
            ))}
          </div>

          {/* 입력 폼 및 실행 영역 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* 좌측: 매니페스트 & 에러 메시지 입력 (6 cols) */}
            <div className="space-y-4 lg:col-span-6">
              <Card className="border border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Code2 className="size-4.5 text-cyan-600" />
                      <CardTitle className="text-sm font-bold text-slate-900">
                        배포 시도한 매니페스트 (YAML)
                      </CardTitle>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-rose-200 bg-rose-50 text-[10px] text-rose-700 font-semibold"
                    >
                      필수 입력
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    kubectl apply 시도 후 생성이 거부된 Pod 또는 Deployment YAML
                    원문입니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="relative rounded-xl border border-slate-800 bg-[#0c1322] font-mono text-xs shadow-inner">
                    <textarea
                      value={manifestYaml}
                      onChange={(e) => setManifestYaml(e.target.value)}
                      rows={10}
                      placeholder="apiVersion: v1&#10;kind: Pod&#10;..."
                      className="w-full resize-y bg-transparent p-3.5 text-slate-100 caret-cyan-400 outline-none focus:ring-1 focus:ring-indigo-500/50 leading-5"
                      spellCheck={false}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HelpCircle className="size-4.5 text-amber-500" />
                      <CardTitle className="text-sm font-bold text-slate-900">
                        kubectl 실패 에러 메시지 (선택 입력)
                      </CardTitle>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-slate-200 bg-slate-100 text-[10px] text-slate-600 font-medium"
                    >
                      선택 사항
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-slate-500">
                    터미널이나 CI/CD 콘솔에 출력된 Kyverno webhook 거절 메시지를
                    붙여넣으면 분석 정확도가 향상됩니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="relative rounded-xl border border-slate-800 bg-[#0c1322] font-mono text-xs shadow-inner">
                    <textarea
                      value={errorMessage}
                      onChange={(e) => setErrorMessage(e.target.value)}
                      rows={5}
                      placeholder="Error from server (Forbidden): admission webhook denied the request..."
                      className="w-full resize-y bg-transparent p-3.5 text-slate-200 caret-cyan-400 outline-none focus:ring-1 focus:ring-indigo-500/50 leading-5"
                      spellCheck={false}
                    />
                  </div>

                  <div className="mt-4 flex justify-end">
                    <Button
                      onClick={handleDiagnose}
                      disabled={isDiagnosing || !manifestYaml.trim()}
                      className="gap-2 bg-gradient-to-r from-rose-600 via-purple-600 to-indigo-600 text-white font-medium shadow-sm hover:from-rose-500 hover:to-indigo-500"
                    >
                      {isDiagnosing ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          AI 정책 진단 분석 중...
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-4" />
                          AI Enforce 차단 진단 실행
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 우측: 진단 리포트 및 해결 가이드 (6 cols) */}
            <div className="space-y-4 lg:col-span-6">
              {!result && !isDiagnosing && (
                <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/70 p-8 text-center shadow-sm">
                  <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4 text-slate-400 mb-3">
                    <Sparkles className="size-8 text-indigo-500" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">
                    AI 진단 대기 중
                  </h3>
                  <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">
                    좌측에 배포 실패 매니페스트를 입력하거나 상단 예시를 선택한
                    뒤 <strong>[AI Enforce 차단 진단 실행]</strong> 버튼을
                    누르세요.
                  </p>
                </div>
              )}

              {isDiagnosing && (
                <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50/50 p-8 text-center shadow-sm animate-pulse">
                  <Loader2 className="size-10 text-indigo-600 animate-spin mb-4" />
                  <h3 className="text-base font-bold text-indigo-950">
                    AI 거버넌스 분석 진행 중...
                  </h3>
                  <p className="mt-1 text-xs text-indigo-700">
                    어드미션 웹훅 정책 룰셋과 리소스 YAML 구조를 교차 검증하고
                    있습니다.
                  </p>
                </div>
              )}

              {result && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  {/* 진단 요약 카드 */}
                  <Card className="border border-rose-200 bg-white shadow-sm">
                    <CardHeader className="border-b border-rose-100 pb-3 bg-rose-50/60 rounded-t-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="size-5 text-rose-600" />
                          <CardTitle className="text-sm font-bold text-rose-950">
                            차단 원인 진단 요약
                          </CardTitle>
                        </div>
                        <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10px] font-semibold">
                          {result.provider &&
                          result.provider !== "RULE_ENGINE_FALLBACK" &&
                          result.provider !== "NONE"
                            ? `${result.provider} AI 분석`
                            : "룰 엔진 분석"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-3">
                      <p className="text-xs leading-relaxed text-slate-800 font-medium">
                        {result.summary}
                      </p>

                      {/* 왜 이 정책이 Enforce로 강제되는가? */}
                      {result.governanceRationale && (
                        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-950">
                          <div className="flex items-center gap-1.5 font-bold text-indigo-900 mb-1">
                            <Info className="size-3.5" />
                            <span>
                              사내 정책 강제(Enforce) 도입 배경 및 거버넌스 사유
                            </span>
                          </div>
                          <p className="text-slate-700 leading-relaxed text-[11px]">
                            {result.governanceRationale}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* 해결 조치 단계 */}
                  {result.resolutionSteps &&
                    result.resolutionSteps.length > 0 && (
                      <Card className="border border-slate-200 bg-white shadow-sm">
                        <CardHeader className="pb-3 border-b border-slate-100">
                          <CardTitle className="text-xs font-bold text-slate-900 flex items-center gap-2">
                            <CheckCircle2 className="size-4 text-emerald-600" />
                            단계별 해결 가이드
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-3">
                          <ul className="space-y-2">
                            {result.resolutionSteps.map((step, idx) => (
                              <li
                                key={idx}
                                className="flex items-start gap-2.5 text-xs text-slate-700"
                              >
                                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                                  {idx + 1}
                                </span>
                                <span className="leading-5">{step}</span>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    )}

                  {/* 수정된 대체 YAML */}
                  {result.suggestedFixYaml && (
                    <Card className="border border-emerald-200 bg-white shadow-sm">
                      <CardHeader className="border-b border-emerald-100 pb-3 bg-emerald-50/50 rounded-t-xl">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sparkles className="size-4.5 text-emerald-600" />
                            <CardTitle className="text-sm font-bold text-emerald-950">
                              AI 권장 수정 YAML (Compliant Code)
                            </CardTitle>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCopyFix}
                            className="h-7 gap-1.5 border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium"
                          >
                            {copiedFix ? (
                              <>
                                <Check className="size-3.5 text-emerald-600" />
                                복사 완료!
                              </>
                            ) : (
                              <>
                                <Copy className="size-3.5" />
                                수정된 YAML 복사
                              </>
                            )}
                          </Button>
                        </div>
                        <CardDescription className="text-xs text-slate-500">
                          이 설정을 적용하면 Kyverno 어드미션 웹훅을 통과하여
                          정상 배포됩니다.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-3">
                        <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0c1322] p-4 font-mono text-xs text-emerald-300 leading-5 shadow-inner">
                          {result.suggestedFixYaml}
                        </pre>

                        <div className="mt-3 flex items-center justify-between pt-1">
                          <Link href="/simulation">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-cyan-700 hover:text-cyan-900 hover:bg-cyan-50 gap-1.5 font-medium"
                            >
                              <FlaskConical className="size-3.5" />
                              정책 테스트 랩에서 즉시 시뮬레이션
                            </Button>
                          </Link>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* 정책 예외 신청 연계 CTA */}
                  <div className="rounded-xl border border-amber-200 bg-amber-100/60 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-2 text-xs text-amber-950 font-medium">
                      <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                      <span>
                        업무 특성상 규정 수정을 할 수 없고 예외가 필요하신가요?
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
                        className="w-full sm:w-auto gap-2 bg-gradient-to-r from-amber-500 to-orange-500 font-semibold text-slate-950 hover:from-amber-400 hover:to-orange-400 text-xs shadow-sm"
                      >
                        <FilePlus2 className="size-3.5" />
                        정책 예외(PolicyException) 신청
                        <ArrowRight className="size-3" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DashboardPageShell>
    </ProtectedRoute>
  );
}
