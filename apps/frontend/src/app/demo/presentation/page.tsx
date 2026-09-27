"use client";

import { useState } from "react";
import {
  ShieldCheck,
  BarChart3,
  Columns,
  Maximize2,
  Minimize2,
  ExternalLink,
  Info,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ViewMode = "policy-reporter" | "grafana" | "split";

/**
 * Kubernetes 거버넌스 시연용 임시 프레젠테이션 허브 컴포넌트
 *
 * CS 지식은 있으나 Kubernetes 상세 기술에 익숙하지 않은 청중에게
 * Policy Reporter(감사 리포트)와 Grafana(차단 메트릭)를 직관적인 UI로 제공합니다.
 *
 * @returns 시연용 대시보드 뷰
 */
export default function DemoPresentationPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(true);

  // 환경변수 또는 로컬 포트포워딩 기본 주소
  const policyReporterUrl =
    process.env.NEXT_PUBLIC_POLICY_REPORTER_URL || "http://localhost:8082";
  const grafanaUrl =
    process.env.NEXT_PUBLIC_GRAFANA_URL ||
    "http://localhost:3001/d/kyverno/kyverno-dashboard?kiosk&refresh=5s";

  /**
   * 브라우저 전체 화면 모드를 토글합니다.
   */
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        // 브라우저 권한 제한 시 무시
      });
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {
          // 전체화면 해제 실패 시 무시
        });
      }
      setIsFullscreen(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 1. 프레젠테이션 상단 헤더 */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded-md border border-indigo-500/20">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-xs tracking-wider uppercase">
              Kyverno Live Demo
            </span>
          </div>
          <h1 className="text-sm font-bold text-white hidden sm:inline">
            Policy Governance Observability Hub
          </h1>
          <Badge
            variant="outline"
            className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10"
          >
            Demo Session
          </Badge>
        </div>

        {/* 2. 뷰 전환 및 액션 버튼 툴바 */}
        <div className="flex items-center gap-1.5">
          <div className="flex bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/60">
            <Button
              size="sm"
              variant={viewMode === "split" ? "default" : "ghost"}
              onClick={() => setViewMode("split")}
              className="h-7 text-xs px-2.5"
            >
              <Columns className="w-3.5 h-3.5 mr-1" /> Dual View
            </Button>
            <Button
              size="sm"
              variant={viewMode === "policy-reporter" ? "default" : "ghost"}
              onClick={() => setViewMode("policy-reporter")}
              className="h-7 text-xs px-2.5"
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Policy Reporter
            </Button>
            <Button
              size="sm"
              variant={viewMode === "grafana" ? "default" : "ghost"}
              onClick={() => setViewMode("grafana")}
              className="h-7 text-xs px-2.5"
            >
              <BarChart3 className="w-3.5 h-3.5 mr-1" /> Grafana Metrics
            </Button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowGuide((prev) => !prev)}
            className="h-7 text-xs px-2 text-slate-300 hover:text-white"
            title="시연 스토리보드 가이드 토글"
          >
            <Info className="w-3.5 h-3.5 mr-1" /> Guide
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={toggleFullscreen}
            className="h-7 w-7 p-0 text-slate-300 hover:text-white"
            title="전체화면"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </header>

      {/* 3. 발표자용 3-Act 시연 스토리보드 안내 배너 (토글 가능) */}
      {showGuide && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-indigo-950/40 border-b border-indigo-900/50 text-[11px] shrink-0 text-slate-300">
          <div className="flex items-center gap-4 overflow-x-auto py-0.5">
            <span className="text-indigo-400 font-semibold flex items-center gap-1">
              <Terminal className="w-3 h-3" /> Live Acts:
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <strong>Act 1 (Enforce 차단):</strong> 위험 파드 배포 시 즉시 403
              차단 & Grafana 게이지 급증
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <strong>Act 2 (Audit 감사):</strong> latest 태그 파드 허용 후
              Policy Reporter에 위반 티켓 생성
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <strong>Act 3 (정상 규격):</strong> 모든 규정 준수 파드 배포 및
              All Green 확인
            </span>
          </div>
          <button
            onClick={() => setShowGuide(false)}
            className="text-slate-500 hover:text-slate-300 text-xs ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* 4. 메인 프레임워크 뷰 영역 */}
      <main className="flex-1 flex w-full h-full p-2 gap-2 overflow-hidden bg-slate-900/50">
        {/* Policy Reporter 패널 */}
        {(viewMode === "split" || viewMode === "policy-reporter") && (
          <div className="flex-1 flex flex-col h-full rounded-lg border border-slate-800 bg-slate-950 overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs font-medium text-slate-300">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>CNCF Policy Reporter (PolicyReport CRD Audit)</span>
              </div>
              <a
                href={policyReporterUrl}
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:text-indigo-400 flex items-center gap-1 text-[11px]"
              >
                새 창 <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex-1 w-full h-full relative">
              <iframe
                src={policyReporterUrl}
                className="w-full h-full border-0 bg-white"
                title="Policy Reporter UI"
              />
            </div>
          </div>
        )}

        {/* Grafana Dashboard 패널 */}
        {(viewMode === "split" || viewMode === "grafana") && (
          <div className="flex-1 flex flex-col h-full rounded-lg border border-slate-800 bg-slate-950 overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs font-medium text-slate-300">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Grafana Live Telemetry (Admission Spikes)</span>
              </div>
              <a
                href={grafanaUrl}
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:text-indigo-400 flex items-center gap-1 text-[11px]"
              >
                새 창 <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex-1 w-full h-full relative">
              <iframe
                src={grafanaUrl}
                className="w-full h-full border-0 bg-slate-950"
                title="Grafana Kyverno Dashboard"
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
