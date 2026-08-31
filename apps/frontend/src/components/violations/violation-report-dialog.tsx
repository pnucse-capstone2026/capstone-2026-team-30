"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Download,
  FileCheck,
  FileJson,
  FileSpreadsheet,
  FileText,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { exportToCSV } from "@/lib/export-utils";
import {
  severityClassName,
  severityLabel,
  statusClassName,
  statusLabel,
  type PolicyViolation,
} from "@/lib/policy-violations";

type ViolationReportDialogProps = {
  violation: PolicyViolation;
  trigger?: React.ReactNode;
};

export function ViolationReportDialog({
  violation,
  trigger,
}: ViolationReportDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const reportData = {
    reportGeneratedAt: new Date().toISOString(),
    violationId: violation.id,
    clusterId: violation.clusterId ?? violation.clusterName,
    clusterDisplayName: violation.clusterDisplayName ?? violation.clusterName,
    namespace: violation.namespace,
    policyName: violation.policyName,
    policyType: violation.policyType,
    ruleName: violation.ruleName,
    resource: {
      kind: violation.resourceKind,
      name: violation.resourceName,
      namespace: violation.namespace,
      path: violation.resourcePath,
    },
    severity: violation.severity,
    severityKorean: severityLabel[violation.severity],
    status: violation.status,
    statusKorean: statusLabel[violation.status],
    detectedAt: violation.detectedAt,
    errorMessage: violation.message,
    recommendation: violation.recommendation,
    engineResponse: violation.engineResponse,
    assignee: violation.assignee,
    events: violation.events,
  };

  const handleDownloadJSON = () => {
    const filename = `violation-report-${violation.policyName}-${violation.resourceName}.json`;
    const jsonStr = JSON.stringify(reportData, null, 2);
    const blob = new Blob([jsonStr], {
      type: "application/json;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`JSON 진단 리포트를 다운로드했습니다: ${filename}`);
  };

  const handleDownloadCSV = () => {
    const filename = `violation-report-${violation.policyName}-${violation.resourceName}.csv`;
    exportToCSV(
      filename,
      [
        { key: "violationId", label: "위반 ID" },
        { key: "policyName", label: "정책명" },
        { key: "ruleName", label: "규칙명" },
        { key: "clusterDisplayName", label: "클러스터" },
        { key: "namespace", label: "네임스페이스" },
        { key: (d) => d.resource.kind, label: "리소스 종류" },
        { key: (d) => d.resource.name, label: "리소스명" },
        { key: "severityKorean", label: "심각도" },
        { key: "statusKorean", label: "처리 상태" },
        { key: "detectedAt", label: "탐지 일시" },
        { key: "errorMessage", label: "오류 메시지" },
        { key: "recommendation", label: "권장 조치 방안" },
      ],
      [reportData],
    );
    toast.success(`CSV 진단 리포트를 다운로드했습니다: ${filename}`);
  };

  const handleCopyMarkdown = () => {
    const markdown = `# 정책 위반 진단 리포트
- **위반 ID**: ${violation.id}
- **정책명**: ${violation.policyName}
- **규칙명**: ${violation.ruleName}
- **대상 리소스**: ${violation.resourceKind} / ${violation.resourceName} (${violation.namespace})
- **클러스터**: ${violation.clusterDisplayName || violation.clusterName}
- **심각도**: ${severityLabel[violation.severity]}
- **처리 상태**: ${statusLabel[violation.status]}
- **탐지 일시**: ${violation.detectedAt}

## 오류 메시지
${violation.message}

## 권장 해결 조치
${violation.recommendation}

## 감사 및 처리 이력
${violation.events.map((e) => `- [${e.at}] **${e.label}**: ${e.description}`).join("\n")}
`;

    navigator.clipboard.writeText(markdown);
    setIsCopied(true);
    toast.success("진단 리포트 요약이 클립보드에 복사되었습니다.");
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <Download className="size-4" />
            리포트
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <FileText className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">
                정책 위반 진단 리포트
              </DialogTitle>
              <DialogDescription>
                해당 위반 항목의 세부 분석 정보 및 권장 조치 방안 명세서입니다.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-4 space-y-5 text-sm text-slate-700">
          {/* 상단 메타 배지 */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={severityClassName[violation.severity]}>
              <AlertTriangle className="size-3" />
              {severityLabel[violation.severity]}
            </Badge>
            <Badge className={statusClassName[violation.status]}>
              {statusLabel[violation.status]}
            </Badge>
            <Badge variant="outline" className="text-slate-600">
              {violation.clusterDisplayName || violation.clusterName}
            </Badge>
            <Badge variant="outline" className="text-slate-600">
              {violation.namespace}
            </Badge>
          </div>

          {/* 위반 개요 카드 */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <h4 className="flex items-center gap-2 font-semibold text-slate-900">
              <ShieldAlert className="size-4 text-amber-500" />
              위반 및 리소스 식별 정보
            </h4>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="font-medium text-slate-400">정책명:</span>{" "}
                <span className="font-semibold text-slate-800">
                  {violation.policyName}
                </span>
              </div>
              <div>
                <span className="font-medium text-slate-400">규칙명:</span>{" "}
                <span className="font-semibold text-slate-800">
                  {violation.ruleName}
                </span>
              </div>
              <div>
                <span className="font-medium text-slate-400">대상 리소스:</span>{" "}
                <span className="font-semibold text-slate-800">
                  {violation.resourceKind} / {violation.resourceName}
                </span>
              </div>
              <div>
                <span className="font-medium text-slate-400">탐지 일시:</span>{" "}
                <span className="text-slate-800">{violation.detectedAt}</span>
              </div>
            </div>
          </div>

          {/* 오류 메시지 */}
          <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-4 text-rose-950">
            <h4 className="font-semibold text-xs text-rose-800">
              위반 발생 사유 (에러 메시지)
            </h4>
            <p className="mt-1.5 font-mono text-xs leading-relaxed">
              {violation.message}
            </p>
          </div>

          {/* 권장 조치 방안 */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-blue-950">
            <h4 className="flex items-center gap-1.5 font-semibold text-xs text-blue-800">
              <FileCheck className="size-4" />
              권장 해결 조치 방안
            </h4>
            <p className="mt-1.5 text-xs leading-relaxed">
              {violation.recommendation}
            </p>
          </div>

          {/* 감사 및 처리 이력 */}
          {violation.events && violation.events.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="font-semibold text-xs text-slate-900">
                감사 및 처리 이력 타임라인
              </h4>
              <div className="mt-3 space-y-2">
                {violation.events.map((e, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-xs text-slate-600"
                  >
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-blue-500" />
                    <div>
                      <span className="font-semibold text-slate-800">
                        {e.label}
                      </span>{" "}
                      <span className="text-[11px] text-slate-400">
                        ({e.at})
                      </span>
                      <p className="mt-0.5 text-slate-500">{e.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 리소스 매니페스트 미리보기 */}
          {violation.manifest && (
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 font-semibold text-xs text-slate-900">
                  <Code2 className="size-4 text-slate-500" />
                  리소스 매니페스트 (YAML)
                </h4>
              </div>
              <pre className="mt-2 max-h-40 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
                <code>{violation.manifest}</code>
              </pre>
            </div>
          )}

          {/* 내보내기 액션 버튼 바 */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleCopyMarkdown}
            >
              {isCopied ? (
                <>
                  <Check className="size-3.5 text-emerald-500" />
                  복사됨
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  텍스트 복사
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleDownloadCSV}
            >
              <FileSpreadsheet className="size-3.5 text-emerald-600" />
              CSV 다운로드
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-[#0b2342] text-xs text-white hover:bg-[#12325b]"
              onClick={handleDownloadJSON}
            >
              <FileJson className="size-3.5 text-amber-300" />
              JSON 리포트 다운로드
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
