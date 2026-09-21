"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Clock,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Users,
} from "lucide-react";

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
  defaultTab?: "sla" | "assignment" | "approval";
}

export function ProcessingStandardsDialog({
  open,
  onOpenChange,
  defaultTab = "sla",
}: ProcessingStandardsDialogProps) {
  const [config, setConfig] = useState<ProcessingStandardsConfig>(
    DEFAULT_PROCESSING_STANDARDS,
  );
  const [activeTab, setActiveTab] = useState<"sla" | "assignment" | "approval">(
    defaultTab,
  );

  // 모달이 열릴 때 저장된 설정값 불러오기 및 기본 탭 적용
  useEffect(() => {
    if (open) {
      setConfig(loadProcessingStandards());
      setActiveTab(defaultTab);
    }
  }, [open, defaultTab]);

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

  const handleApprovalChange = (
    key: keyof ProcessingStandardsConfig["approval"],
    val: number | boolean | string,
  ) => {
    setConfig((prev) => ({
      ...prev,
      approval: {
        ...prev.approval,
        [key]: val,
      },
    }));
  };

  const handleSave = () => {
    saveProcessingStandards(config);
    toast.success("처리 및 승인 기준이 성공적으로 저장되었습니다.");
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
                정책 오류 및 예외 처리 기준 설정
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-slate-500">
                심각도별 조치 기한(SLA), 담당 그룹 및 예외 승인 판정 기준을
                관리합니다.
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
          <button
            type="button"
            onClick={() => setActiveTab("approval")}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-colors ${
              activeTab === "approval"
                ? "border-[#0b2342] font-semibold text-[#0b2342] dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            <ShieldCheck className="size-3.5" />
            예외 승인 기준
          </button>
        </div>

        {/* Tab Content */}
        <div className="min-h-[260px] max-h-[60vh] overflow-y-auto py-2 pr-1">
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
                    기본 처리 담당자 / 담당 조직 (Default Assignee)
                  </label>
                  <Input
                    type="text"
                    value={config.assignment.defaultAssigneeGroup}
                    onChange={(e) =>
                      handleAssignmentChange(
                        "defaultAssigneeGroup",
                        e.target.value,
                      )
                    }
                    placeholder="예: 보안 관리자, 인프라 운영팀 (미입력 시 미지정)"
                    className="mt-2 h-9 text-xs"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    정책 위반 발생 시 기본으로 할당될 담당자 이메일 또는 조직명을 자유롭게 지정합니다.
                  </p>
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

          {activeTab === "approval" && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                정책 예외 신청의 승인 요건, 최대 허용 유효기간 및 자동 승인
                기준을 설정합니다.
              </p>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                  <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                    최대 허용 유효기간 (Maximum Validity Days)
                  </label>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    예외 신청 시 설정 가능한 최대 허용 기간입니다.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={config.approval.maxValidityDays}
                      onChange={(e) =>
                        handleApprovalChange(
                          "maxValidityDays",
                          Math.max(1, parseInt(e.target.value, 10) || 1),
                        )
                      }
                      className="h-9 w-28 rounded-lg bg-white text-xs dark:bg-slate-950"
                    />
                    <span className="text-xs text-slate-500">일</span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3 dark:border-slate-800 dark:bg-slate-900/50">
                  <div>
                    <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                      고위험(High/Critical) 승인 권한 역할
                    </label>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      고위험 예외 신청 건을 최종 승인할 수 있는 최소 관리자 역할
                    </p>
                    <select
                      value={config.approval.criticalRiskApprovalRole}
                      onChange={(e) =>
                        handleApprovalChange(
                          "criticalRiskApprovalRole",
                          e.target.value,
                        )
                      }
                      className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                    >
                      <option value="Security Admin">
                        보안 관리자 (Security Admin)
                      </option>
                      <option value="Platform Lead">
                        플랫폼 엔지니어링 리드 (Platform Lead)
                      </option>
                      <option value="CISO Group">
                        CISO / 정보보호 책임 그룹 (CISO Group)
                      </option>
                    </select>
                  </div>

                  <label className="flex items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={config.approval.requireCompensatingControl}
                      onChange={(e) =>
                        handleApprovalChange(
                          "requireCompensatingControl",
                          e.target.checked,
                        )
                      }
                      className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        필수 보안 통제(Compensating Control) 기재 의무화
                      </span>
                      <p className="text-[11px] text-slate-500">
                        예외 신청 시 대체 보안 통제 대책이 작성되어야만 승인
                        검토가 가능합니다.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={config.approval.autoApproveLowRisk}
                      onChange={(e) =>
                        handleApprovalChange(
                          "autoApproveLowRisk",
                          e.target.checked,
                        )
                      }
                      className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        낮음(Low) 위험도 예외 자동 승인
                      </span>
                      <p className="text-[11px] text-slate-500">
                        위험도 등급이 낮음인 신청 건에 대해 관리자 수동 승인
                        없이 즉시 활성화합니다.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={config.approval.allowEmergencyApproval}
                      onChange={(e) =>
                        handleApprovalChange(
                          "allowEmergencyApproval",
                          e.target.checked,
                        )
                      }
                      className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        긴급 승인(Emergency Approval) 권한 활성화
                      </span>
                      <p className="text-[11px] text-slate-500">
                        서비스 장애 등 긴급 상황 시 사전 심의 절차를 단축하여
                        승인할 수 있습니다.
                      </p>
                    </div>
                  </label>
                </div>
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
