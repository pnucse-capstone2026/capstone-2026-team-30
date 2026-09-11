"use client";

import Link from "next/link";
import { ArrowLeft, ShieldAlert, Terminal } from "lucide-react";
import { PlatformModuleId, useSystemModules } from "@/lib/system-modules";

type ModuleDisabledNoticeProps = {
  moduleId: PlatformModuleId;
  title?: string;
  description?: string;
};

const MODULE_ENV_VARS: Record<PlatformModuleId, string> = {
  core: "MODULE_CORE_ENABLED",
  mlops: "MODULE_MLOPS_ENABLED",
  aiAgent: "MODULE_AI_AGENT_ENABLED",
  simulation: "MODULE_SIMULATION_ENABLED",
  gitops: "MODULE_GITOPS_ENABLED",
};

/**
 * 특정 플랫폼 기능 모듈이 비활성화되었을 때 사용자에게 사유와 활성화 방법을 안내하는 컴포넌트
 */
export function ModuleDisabledNotice({
  moduleId,
  title,
  description,
}: ModuleDisabledNoticeProps) {
  const { modules } = useSystemModules();
  const moduleMeta = modules[moduleId];
  const moduleName = moduleMeta?.name ?? moduleId;
  const envVarName =
    MODULE_ENV_VARS[moduleId] ?? `MODULE_${moduleId.toUpperCase()}_ENABLED`;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-800 bg-[#0c1f38]/80 p-8 shadow-2xl backdrop-blur-sm">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-400">
          <ShieldAlert className="size-7" />
        </div>

        <h2 className="text-xl font-bold tracking-tight text-white">
          {title ?? `${moduleName} 모듈 비활성화 알림`}
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          {description ??
            `현재 플랫폼 환경에서는 ${moduleName} 기능이 비활성화되어 접근할 수 없습니다.`}
        </p>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <Terminal className="size-3.5 text-cyan-400" />
            <span>기능 활성화 방법</span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-cyan-300">
            {envVarName}=true
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            플랫폼 배포 시 환경 변수 또는 Secret에 위 플래그를 설정하세요.
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all hover:opacity-90"
          >
            <ArrowLeft className="size-4" />
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
