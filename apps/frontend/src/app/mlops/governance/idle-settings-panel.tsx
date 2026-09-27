"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GovernanceSettings,
  IdleInspectionResult,
} from "@/lib/ml-governance-api";
import { Clock, Play, RefreshCw, Settings, Sliders, Zap } from "lucide-react";

type IdleSettingsPanelProps = {
  settings?: GovernanceSettings;
  isLoading?: boolean;
  onUpdateSettings: (updated: Partial<GovernanceSettings>) => Promise<unknown>;
  onTriggerMonitor: () => Promise<IdleInspectionResult>;
};

export function IdleSettingsPanel({
  settings,
  isLoading,
  onUpdateSettings,
  onTriggerMonitor,
}: IdleSettingsPanelProps) {
  const [threshold, setThreshold] = useState<number>(
    settings?.idleThresholdHours ?? 2,
  );
  const [autoStop, setAutoStop] = useState<boolean>(
    settings?.autoStopEnabled ?? true,
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [lastResult, setLastResult] = useState<IdleInspectionResult | null>(
    null,
  );

  const handleSaveSettings = async () => {
    setIsUpdating(true);
    try {
      await onUpdateSettings({
        idleThresholdHours: Number(threshold),
        autoStopEnabled: autoStop,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleTriggerNow = async () => {
    setIsTriggering(true);
    try {
      const res = await onTriggerMonitor();
      setLastResult(res);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <CardTitle className="text-lg font-semibold">
            Idle Workload Auto-Shutdown Settings
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {isLoading ? (
          <div className="h-40 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-xl" />
        ) : (
          <>
            {/* Auto-Stop Toggle & Threshold Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2 text-slate-900 dark:text-slate-100">
                  <Clock className="h-4 w-4 text-indigo-500" />
                  유휴 판별 임계시간 (Idle Threshold)
                </label>
                <p className="text-xs text-slate-500">
                  노트북 CPU/GPU 리소스 사용량이 판별 기준 이하일 때 자동 중지할
                  시간
                </p>
                <div className="flex items-center gap-3 pt-1">
                  <select
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="h-9 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                  >
                    <option value={1}>1 시간 (최대 절감)</option>
                    <option value={2}>2 시간 (권장)</option>
                    <option value={4}>4 시간</option>
                    <option value={8}>8 시간</option>
                    <option value={12}>12 시간</option>
                    <option value={24}>24 시간</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2 text-slate-900 dark:text-slate-100">
                  <Zap className="h-4 w-4 text-emerald-500" />
                  자동 중지 기능 스케줄러
                </label>
                <p className="text-xs text-slate-500">
                  임계시간 도달 시 @Cron 서비스가 자동으로 노트북을 stop
                  처리합니다.
                </p>
                <div className="flex items-center gap-3 pt-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoStop}
                      onChange={(e) => setAutoStop(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    <span className="ml-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {autoStop ? "자동 중지 활성화됨" : "자동 중지 비활성화"}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Save & Trigger Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <button
                onClick={handleSaveSettings}
                disabled={isUpdating}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-sm"
              >
                {isUpdating ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sliders className="h-3.5 w-3.5" />
                )}
                설정 저장 적용
              </button>

              <button
                onClick={handleTriggerNow}
                disabled={isTriggering}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-sm"
              >
                {isTriggering ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                수동 유휴 감시 즉시 실행
              </button>
            </div>

            {/* Last Execution Result Display */}
            {lastResult && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg text-xs space-y-1">
                <div className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-emerald-600" />
                  유휴 검사 완료: 전체 {lastResult.scannedCount}개 조율 중{" "}
                  {lastResult.idleDetectedCount}개 유휴 감지,{" "}
                  {lastResult.autoStoppedCount}개 노트북 중지 처리됨
                </div>
                {lastResult.stoppedNotebooks.length > 0 && (
                  <p className="text-emerald-700 dark:text-emerald-400 font-mono">
                    Stopped:{" "}
                    {lastResult.stoppedNotebooks.map((n) => n.name).join(", ")}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
