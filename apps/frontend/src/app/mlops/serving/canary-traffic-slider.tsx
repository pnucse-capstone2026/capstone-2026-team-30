"use client";

import { useState } from "react";
import { useUpdateCanaryTraffic } from "@/hooks/use-serving";
import { GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CanaryTrafficSliderProps {
  name: string;
  currentPercent: number;
  clusterId: string;
  namespace: string;
}

export function CanaryTrafficSlider({
  name,
  currentPercent,
  clusterId,
  namespace,
}: CanaryTrafficSliderProps) {
  const [percent, setPercent] = useState<number>(currentPercent);
  const updateMutation = useUpdateCanaryTraffic();

  const handleApply = async () => {
    try {
      await updateMutation.mutateAsync({
        name,
        canaryTrafficPercent: percent,
        clusterId,
        namespace,
      });
      toast.success(`Canary 트래픽 비율이 ${percent}%로 변경되었습니다.`);
    } catch {
      toast.error("Canary 트래픽 비율 변경 중 오류가 발생했습니다.");
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
        <span className="flex items-center gap-1">
          <GitBranch className="h-3.5 w-3.5 text-indigo-500" />
          <span>Canary Traffic Split</span>
        </span>
        <span className="font-mono text-indigo-600 font-bold">{percent}%</span>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
          className="flex-1 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
        />
        <button
          onClick={handleApply}
          disabled={updateMutation.isPending || percent === currentPercent}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span>적용</span>
          )}
        </button>
      </div>
    </div>
  );
}
