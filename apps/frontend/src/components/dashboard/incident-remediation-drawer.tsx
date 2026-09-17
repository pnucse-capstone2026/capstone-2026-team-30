"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileCode2,
  GitCommit,
  GitPullRequest,
  Lock,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";
import {
  DeploymentIncident,
  getIncidentRemediationDraft,
  ignoreIncident,
  remediateIncidentEmergency,
  RemediationDraft,
  resolveIncidentHotfix,
} from "@/lib/incidents-api";

interface IncidentRemediationDrawerProps {
  incident: DeploymentIncident | null;
  isOpen: boolean;
  onClose: () => void;
  onResolved?: (incident: DeploymentIncident) => void;
}

/**
 * 인시던트 긴급 복구(Dual-Path) 보조 드로어 컴포넌트
 *
 * 운영자와 개발자가 차단 원인을 분석하고 3대 보조 경로(정식 신청, 긴급 발행, 핫픽스 종결)를 통해
 * 안전하고 투명하게 복구 작업을 수행할 수 있도록 지원합니다.
 */
export function IncidentRemediationDrawer({
  incident,
  isOpen,
  onClose,
  onResolved,
}: IncidentRemediationDrawerProps) {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === "ADMIN";

  const [activeTab, setActiveTab] = useState<"pathA" | "pathB" | "pathC">(
    "pathA",
  );
  const [draft, setDraft] = useState<RemediationDraft | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);

  // 긴급 발행 (경로 B) 폼 상태
  const [ttlHours, setTtlHours] = useState<number>(24);
  const [emergencyReason, setEmergencyReason] = useState<string>("");
  const [publishToGitOps, setPublishToGitOps] = useState<boolean>(true);
  const [isSubmittingEmergency, setIsSubmittingEmergency] = useState(false);

  // 핫픽스/무시 (경로 C) 폼 상태
  const [commitSha, setCommitSha] = useState<string>("");
  const [hotfixNote, setHotfixNote] = useState<string>("");
  const [ignoreReason, setIgnoreReason] = useState<string>("");
  const [isSubmittingHotfix, setIsSubmittingHotfix] = useState(false);
  const [isSubmittingIgnore, setIsSubmittingIgnore] = useState(false);

  useEffect(() => {
    if (!isOpen || !incident) {
      setDraft(null);
      return;
    }

    let isMounted = true;
    setIsLoadingDraft(true);

    getIncidentRemediationDraft(incident.id)
      .then((data) => {
        if (isMounted) {
          setDraft(data);
          setTtlHours(data.defaultTtlHours || 24);
        }
      })
      .catch((err) => {
        if (isMounted) {
          toast.error(
            err instanceof Error ? err.message : "초안을 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingDraft(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, incident]);

  if (!isOpen || !incident) {
    return null;
  }

  const copyYamlToClipboard = () => {
    if (!draft?.suggestedExceptionYaml) return;
    navigator.clipboard.writeText(draft.suggestedExceptionYaml);
    toast.success("PolicyException YAML이 클립보드에 복사되었습니다.");
  };

  const handleEmergencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error("긴급 임시 예외 발행은 ADMIN 권한만 가능합니다.");
      return;
    }
    if (!emergencyReason.trim()) {
      toast.error("긴급 발행 사유를 입력해 주세요.");
      return;
    }

    setIsSubmittingEmergency(true);
    try {
      const updated = await remediateIncidentEmergency(incident.id, {
        reason: emergencyReason.trim(),
        ttlHours,
        publishToGitOps,
      });
      toast.success(
        "긴급 임시 예외가 성공적으로 발행되어 배포 차단이 해제되었습니다!",
      );
      onResolved?.(updated);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "긴급 임시 예외 발행에 실패했습니다.",
      );
    } finally {
      setIsSubmittingEmergency(false);
    }
  };

  const handleHotfixSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingHotfix(true);
    try {
      const updated = await resolveIncidentHotfix(incident.id, {
        commitSha: commitSha.trim() || undefined,
        note: hotfixNote.trim() || undefined,
      });
      toast.success("인시던트가 Hotfix 해결 완료 상태로 종결되었습니다.");
      onResolved?.(updated);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Hotfix 종결 처리에 실패했습니다.",
      );
    } finally {
      setIsSubmittingHotfix(false);
    }
  };

  const handleIgnoreSubmit = async () => {
    setIsSubmittingIgnore(true);
    try {
      const updated = await ignoreIncident(incident.id, {
        reason: ignoreReason.trim() || "운영자 수동 무시 처리",
      });
      toast.success("인시던트가 무시(IGNORED) 상태로 종결되었습니다.");
      onResolved?.(updated);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "인시던트 무시 처리에 실패했습니다.",
      );
    } finally {
      setIsSubmittingIgnore(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div
        className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform animate-in slide-in-from-right sm:border-l sm:border-slate-200"
        role="dialog"
        aria-modal="true"
      >
        {/* 상단 헤더 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                배포 차단 인시던트 복구 보조
              </h2>
              <p className="text-xs text-slate-500">
                ID: <span className="font-mono">{incident.id.slice(0, 8)}</span>{" "}
                · 누적 차단 {incident.blockCount}회
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* 차단 원인 분석 카드 */}
          <section className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-600" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-xs text-rose-900">
                    Kyverno Admission 차단 원인
                  </span>
                  <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 text-[10px]">
                    {incident.clusterId}
                  </Badge>
                  {incident.gitopsAppName && (
                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[10px]">
                      ArgoCD: {incident.gitopsAppName}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-rose-800 break-words font-mono bg-white/70 p-2.5 rounded-lg border border-rose-100">
                  {incident.blockReason}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                  <div>
                    <span className="font-medium text-slate-400">정책:</span>{" "}
                    <span className="font-mono text-slate-800">
                      {incident.policyName}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-400">규칙:</span>{" "}
                    <span className="font-mono text-slate-800">
                      {incident.ruleName || "전체 규칙"}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-400">대상:</span>{" "}
                    <span className="font-mono text-slate-800">
                      {incident.resourceKind}/{incident.resourceName}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-slate-400">
                      네임스페이스:
                    </span>{" "}
                    <span className="font-mono text-slate-800">
                      {incident.namespace || "default"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 3대 보조 복구 경로 탭 선택 */}
          <div>
            <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveTab("pathA")}
                className={`flex-1 rounded-lg py-2 transition ${
                  activeTab === "pathA"
                    ? "bg-white text-blue-700 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                경로 A: 정식 신청 (권장)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("pathB")}
                className={`flex-1 rounded-lg py-2 transition ${
                  activeTab === "pathB"
                    ? "bg-white text-amber-700 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                경로 B: 긴급 발행 (Admin)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("pathC")}
                className={`flex-1 rounded-lg py-2 transition ${
                  activeTab === "pathC"
                    ? "bg-white text-emerald-700 shadow-xs font-semibold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                경로 C: Hotfix 완료 / 무시
              </button>
            </div>
          </div>

          {/* 탭 1: 경로 A [정식 거버넌스 절차] */}
          {activeTab === "pathA" && (
            <div className="space-y-4 animate-in fade-in">
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-xs text-blue-900">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="size-4.5 shrink-0 text-blue-600 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      정식 거버넌스 절차 (안전 권장)
                    </p>
                    <p className="mt-1 text-slate-600 leading-relaxed">
                      인시던트의 리소스 정보가 100% 자동 입력된 정식 예외
                      신청서로 이동하여 승인권자의 결재를 요청합니다.
                    </p>
                  </div>
                </div>
              </div>

              {draft && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">
                      생성될 PolicyException 미리보기
                    </span>
                    <button
                      type="button"
                      onClick={copyYamlToClipboard}
                      className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                    >
                      <Copy className="size-3" /> 복사
                    </button>
                  </div>
                  <pre className="max-h-40 overflow-y-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
                    {draft.suggestedExceptionYaml}
                  </pre>
                </div>
              )}

              <div className="pt-2">
                <Button
                  asChild
                  className="w-full h-11 rounded-xl bg-blue-600 text-white hover:bg-blue-700 gap-2"
                >
                  <Link href={draft?.autoFillUrl || "/exceptions/new"}>
                    <ExternalLink className="size-4" />
                    정식 예외 신청서 작성하기 (원클릭 프리필)
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* 탭 2: 경로 B [긴급 운영자 모드 (ADMIN 전용)] */}
          {activeTab === "pathB" && (
            <form
              onSubmit={handleEmergencySubmit}
              className="space-y-4 animate-in fade-in"
            >
              {!isAdmin ? (
                <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                  <Lock className="size-5 shrink-0 text-amber-600" />
                  <div>
                    <span className="font-semibold">
                      관리자(ADMIN) 전용 기능:
                    </span>{" "}
                    긴급 런타임 우회 및 임시 예외 발행은 ADMIN 권한을 가진
                    운영자만 집행할 수 있습니다.
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-900">
                  <div className="flex items-start gap-2.5">
                    <Zap className="size-4.5 shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">
                        Dual-Path 긴급 임시 예외 발행
                      </p>
                      <p className="mt-1 text-slate-600 leading-relaxed">
                        클러스터에 즉시 런타임 예외를 주입하여 배포를 재개하고,
                        동시에 GitOps 저장소에 추적용 PR을 발행합니다.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {draft && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">
                      발행 매니페스트 (kyverno.io/v2)
                    </span>
                    <button
                      type="button"
                      onClick={copyYamlToClipboard}
                      className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                    >
                      <Copy className="size-3" /> 복사
                    </button>
                  </div>
                  <pre className="max-h-32 overflow-y-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-slate-100">
                    {draft.suggestedExceptionYaml}
                  </pre>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs font-semibold">
                  임시 예외 유효 시간 (TTL: {ttlHours}시간)
                </Label>
                <div className="flex items-center gap-2">
                  {[4, 12, 24, 48, 72].map((hours) => (
                    <button
                      key={hours}
                      type="button"
                      onClick={() => setTtlHours(hours)}
                      disabled={!isAdmin}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition ${
                        ttlHours === hours
                          ? "bg-amber-600 text-white border-amber-600"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {hours}h
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="emergencyReason"
                  className="flex items-center gap-1 text-xs font-semibold"
                >
                  <span>긴급 발행 사유</span>
                  <span className="text-rose-500 font-bold">*</span>
                  <span className="text-[10px] text-rose-500 font-normal">
                    (필수, 감사 로그 기록)
                  </span>
                </Label>
                <textarea
                  id="emergencyReason"
                  rows={2}
                  value={emergencyReason}
                  onChange={(e) => setEmergencyReason(e.target.value)}
                  placeholder="예: 프로덕션 배포 차단으로 인한 긴급 핫픽스 임시 통과 조치"
                  disabled={!isAdmin || isSubmittingEmergency}
                  required
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/10"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={publishToGitOps}
                  onChange={(e) => setPublishToGitOps(e.target.checked)}
                  disabled={!isAdmin || isSubmittingEmergency}
                  className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <span>GitOps 리포지토리에 PolicyException PR 동시 생성</span>
              </label>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={
                    !isAdmin || isSubmittingEmergency || !emergencyReason.trim()
                  }
                  className="w-full h-11 rounded-xl bg-amber-600 text-white hover:bg-amber-700 gap-2"
                >
                  <Zap className="size-4" />
                  {isSubmittingEmergency
                    ? "임시 예외 발행 및 적용 중..."
                    : "확인 후 긴급 임시 예외 발행"}
                </Button>
              </div>
            </form>
          )}

          {/* 탭 3: 경로 C [개발자 조치 완료 / 오탐 무시] */}
          {activeTab === "pathC" && (
            <div className="space-y-5 animate-in fade-in">
              <form onSubmit={handleHotfixSubmit} className="space-y-4">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 text-xs text-emerald-900">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">
                        개발자 매니페스트 Hotfix 수정 완료
                      </p>
                      <p className="mt-1 text-slate-600 leading-relaxed">
                        배포 차단 원인을 Git 저장소의 매니페스트에서 수정한
                        경우, 커밋 SHA와 조치 내용을 기록하고 인시던트를
                        종결합니다.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="commitSha" className="text-xs font-semibold">
                    수정 반영 Git 커밋 SHA (선택)
                  </Label>
                  <Input
                    id="commitSha"
                    value={commitSha}
                    onChange={(e) => setCommitSha(e.target.value)}
                    placeholder="예: 7f8a9b2c3d4e5f6a..."
                    disabled={isSubmittingHotfix}
                    className="h-10 rounded-xl border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="hotfixNote" className="text-xs font-semibold">
                    조치 내용 메모 (선택)
                  </Label>
                  <textarea
                    id="hotfixNote"
                    rows={2}
                    value={hotfixNote}
                    onChange={(e) => setHotfixNote(e.target.value)}
                    placeholder="예: securityContext.runAsNonRoot 속성 추가 후 재배포"
                    disabled={isSubmittingHotfix}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSubmittingHotfix}
                  className="w-full h-10 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 gap-2"
                >
                  <CheckCircle2 className="size-4" />
                  {isSubmittingHotfix
                    ? "종결 처리 중..."
                    : "Hotfix 해결 완료 종결"}
                </Button>
              </form>

              <hr className="border-slate-100" />

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-700">
                  오탐 또는 무시(Ignore) 종결
                </p>
                <div className="space-y-1.5">
                  <Input
                    value={ignoreReason}
                    onChange={(e) => setIgnoreReason(e.target.value)}
                    placeholder="무시 사유 (예: 일시적 테스트 배포)"
                    disabled={isSubmittingIgnore}
                    className="h-9 rounded-xl border-slate-200 text-xs"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleIgnoreSubmit}
                  disabled={isSubmittingIgnore}
                  className="w-full h-9 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 text-xs"
                >
                  {isSubmittingIgnore
                    ? "처리 중..."
                    : "인시던트 무시(Ignore) 종결"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
