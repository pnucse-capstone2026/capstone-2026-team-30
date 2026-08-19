"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  explainKyvernoError,
  ExplainKyvernoErrorResponse,
} from "@/lib/ai-agent-api";
import {
  Bot,
  Sparkles,
  Loader2,
  CheckCircle2,
  ShieldAlert,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";

interface AiErrorExplainerDialogProps {
  trigger?: React.ReactNode;
  errorMessage: string;
  policyYaml?: string;
  resourceManifest?: string;
  clusterContext?: string;
  policyName?: string;
}

/**
 * AWS Bedrock Claude 3.5 Sonnet AI 기반 Kyverno 에러 분석 및 해결 가이드 다이얼로그 컴포넌트
 */
export function AiErrorExplainerDialog({
  trigger,
  errorMessage,
  policyYaml,
  resourceManifest,
  clusterContext,
  policyName,
}: AiErrorExplainerDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ExplainKyvernoErrorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleAnalyze = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await explainKyvernoError({
        errorMessage,
        policyYaml,
        resourceManifest,
        clusterContext,
      });
      setResult(response);
    } catch (err: any) {
      setError(
        err.message || "AWS Bedrock AI 에이전트와 통신 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open && !result && !isLoading) {
      handleAnalyze();
    }
  };

  const handleCopyYaml = () => {
    if (result?.suggestedFixYaml) {
      navigator.clipboard.writeText(result.suggestedFixYaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-300"
          >
            <Sparkles className="h-4 w-4 text-indigo-500" />
            AI 원인 분석 및 해결 가이드
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl">
                Bedrock AI 거버넌스 분석 가이드
                <Badge variant="secondary" className="gap-1 text-xs font-normal">
                  <Sparkles className="h-3 w-3 text-indigo-500" />
                  Claude 3.5 Sonnet
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {policyName
                  ? `'${policyName}' 정책 차단 사유와 수정 방안을 분석합니다.`
                  : "차단된 Kyverno 정책의 원인과 즉시 조치 가능한 가이드를 제공합니다."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="mt-3 space-y-4">
          {/* 차단 에러 원문 */}
          <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-400">
              <ShieldAlert className="h-4 w-4" />
              차단된 에러 메시지
            </div>
            <p className="mt-1 font-mono text-xs text-red-800 dark:text-red-300">
              {errorMessage}
            </p>
          </div>

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" />
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                AWS Bedrock AI 에이전트가 에러 원인 및 해결책을 분석 중입니다...
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Kyverno 매니페스트 및 보안 거버넌스 규칙과 매칭하는 중입니다.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                분석 실패
              </div>
              <p className="mt-1 text-xs">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 text-xs"
                onClick={handleAnalyze}
              >
                다시 시도
              </Button>
            </div>
          )}

          {result && !isLoading && (
            <div className="space-y-5">
              {/* 1. 핵심 요약 */}
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4 dark:border-indigo-900/30 dark:bg-indigo-950/20">
                <h4 className="flex items-center gap-2 text-sm font-bold text-indigo-900 dark:text-indigo-300">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  원인 요약 (Summary)
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                  {result.summary}
                </p>
              </div>

              {/* 2. 거버넌스 배경 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  🛡️ 거버넌스 및 보안 배경
                </h4>
                <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  {result.governanceRationale}
                </p>
              </div>

              {/* 3. 단계별 해결 가이드 */}
              {result.resolutionSteps?.length > 0 && (
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    🛠️ 단계별 해결 방법
                  </h4>
                  <ul className="mt-3 space-y-2">
                    {result.resolutionSteps.map((step, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <span>
                          <strong className="font-semibold text-slate-900 dark:text-slate-100">
                            {idx + 1}단계:
                          </strong>{" "}
                          {step}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 4. 수정 추천 YAML */}
              {result.suggestedFixYaml && (
                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      📄 권장 수정 매니페스트 (YAML)
                    </h4>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={handleCopyYaml}
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                          복사 완료
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          YAML 복사
                        </>
                      )}
                    </Button>
                  </div>
                  <pre className="mt-3 max-h-60 overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-100">
                    <code>{result.suggestedFixYaml}</code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
