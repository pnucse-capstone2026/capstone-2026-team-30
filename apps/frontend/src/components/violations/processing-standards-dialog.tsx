"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, RotateCcw, Save, Sliders, Users } from "lucide-react";

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
import {
  DEFAULT_PROCESSING_STANDARDS,
  loadProcessingStandards,
  saveProcessingStandards,
  SLA_FIELD_DEFINITIONS,
  type ProcessingStandardsConfig,
} from "@/lib/processing-standards";

interface ProcessingStandardsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProcessingStandardsDialog({
  open,
  onOpenChange,
}: ProcessingStandardsDialogProps) {
  const [config, setConfig] = useState<ProcessingStandardsConfig>(
    DEFAULT_PROCESSING_STANDARDS,
  );
  const [activeTab, setActiveTab] = useState<"sla" | "assignment">("sla");

  // 모달이 열릴 때 저장된 설정값 불러오기
  useEffect(() => {
    if (open) {
      setConfig(loadProcessingStandards());
    }
  }, [open]);

  const handleSLAChange = (
    key: keyof ProcessingStandardsConfig["sla"],
    val: number,
  ) => {
    setConfig((prev) => ({
      ...prev,
      sla: {
        ...prev.sla,
        [key]: Math.max(1, isNaN(val) ? 1 : val),
      },
    }));
  };

  const handleAssignmentChange = (
    key: keyof ProcessingStandardsConfig["assignment"],
    val: string | boolean,
  ) => {
    setConfig((prev) => ({
      ...prev,
      assignment: {
        ...prev.assignment,
        [key]: val,
      },
    }));
  };

  const handleSave = () => {
    saveProcessingStandards(config);
    toast.success("정책 오류 처리 기준이 성공적으로 저장되었습니다.");
    onOpenChange(false);
  };

  const handleReset = () => {
    setConfig(DEFAULT_PROCESSING_STANDARDS);
    toast.info("초기 기본 처리 기준값으로 리셋되었습니다.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
              <Sliders className="size-4.5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">
                정책 오류 처리 기준 설정
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-slate-500">
                심각도별 조치 권장 시간(SLA) 및 기본 담당 그룹을 관리합니다.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Tab Buttons */}
        <div className="flex border-b border-slate-200 text-xs font-medium text-slate-600 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab("sla")}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
              activeTab === "sla"
                ? "border-[#0b2342] font-semibold text-[#0b2342] dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Clock className="size-3.5" />
            심각도별 SLA
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("assignment")}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
              activeTab === "assignment"
                ? "border-[#0b2342] font-semibold text-[#0b2342] dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <Users className="size-3.5" />
            담당 그룹 및 에스컬레이션
          </button>
        </div>

        {/* Tab Content */}
        <div className="min-h-[260px] py-2">
          {activeTab === "sla" && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                정책 오류 감지 후 권장되는 조치 완료 목표 시간(SLA)을
                설정합니다.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {SLA_FIELD_DEFINITIONS.map((def) => (
                  <div
                    key={def.key}
                    className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-900/50"
                  >
                    <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {def.label}
                    </label>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {def.description}
                    </p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={720}
                        value={config.sla[def.key]}
                        onChange={(e) =>
                          handleSLAChange(def.key, parseInt(e.target.value, 10))
                        }
                        className="h-9 w-24 rounded-lg bg-white text-xs dark:bg-slate-950"
                      />
                      <span className="text-xs text-slate-500">{def.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "assignment" && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                신규 정책 위반 발생 시 기본 할당 대상 및 네임스페이스 기반 자동
                할당 규칙을 관리합니다.
              </p>
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3 dark:border-slate-800 dark:bg-slate-900/50">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                    기본 처리 담당 팀 (Default Assignee Group)
                  </label>
                  <select
                    value={config.assignment.defaultAssigneeGroup}
                    onChange={(e) =>
                      handleAssignmentChange(
                        "defaultAssigneeGroup",
                        e.target.value,
                      )
                    }
                    className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                  >
                    <option value="SecOps Team">
                      보안 운영팀 (SecOps Team)
                    </option>
                    <option value="DevOps Team">
                      데브옵스팀 (DevOps Team)
                    </option>
                    <option value="Platform Engineering">
                      플랫폼 엔지니어링팀
                    </option>
                    <option value="Compliance Audit Group">
                      규정 준수 감사팀
                    </option>
                  </select>
                </div>

                <label className="flex items-center gap-3 pt-2">
                  <input
                    type="checkbox"
                    checked={config.assignment.autoAssignByNamespace}
                    onChange={(e) =>
                      handleAssignmentChange(
                        "autoAssignByNamespace",
                        e.target.checked,
                      )
                    }
                    className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      네임스페이스 소유자 자동 지정
                    </span>
                    <p className="text-[11px] text-slate-500">
                      Kubernetes Namespace 라벨의 owner 정보에 따라 담당자를
                      자동 할당합니다.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-row items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button
            type="button"
            variant="ghost"
            onClick={handleReset}
            className="h-9 gap-1.5 text-xs text-slate-500 hover:text-slate-900"
          >
            <RotateCcw className="size-3.5" />
            초기화
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9 text-xs"
            >
              취소
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              className="h-9 gap-1.5 bg-[#0b2342] text-xs text-white hover:bg-[#12325b]"
            >
              <Save className="size-3.5" />
              설정 저장
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
