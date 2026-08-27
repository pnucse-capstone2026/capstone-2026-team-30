"use client";

import { useState } from "react";
import { useTestPrediction } from "@/hooks/use-serving";
import { Play, Loader2, Code, Zap } from "lucide-react";
import { toast } from "sonner";

interface ApiTestConsoleDialogProps {
  name: string;
  clusterId: string;
  namespace: string;
}

export function ApiTestConsoleDialog({
  name,
  clusterId,
  namespace,
}: ApiTestConsoleDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [payloadText, setPayloadText] = useState(
    JSON.stringify({ instances: [[0.1, 0.2, 0.3, 0.4, 0.5]] }, null, 2),
  );
  const [testResult, setTestResult] = useState<{
    output: Record<string, unknown>;
    latencyMs: number;
  } | null>(null);

  const testMutation = useTestPrediction();

  const handleTest = async () => {
    try {
      const parsedPayload = JSON.parse(payloadText) as Record<string, unknown>;
      const result = await testMutation.mutateAsync({
        name,
        payload: parsedPayload,
        clusterId,
        namespace,
      });
      setTestResult({ output: result.output, latencyMs: result.latencyMs });
      toast.success("예측 API 테스트 실행 완료");
    } catch (error) {
      toast.error(
        error instanceof SyntaxError
          ? "유효한 JSON 형식이어야 합니다."
          : "API 테스트 실패",
      );
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <Code className="h-3.5 w-3.5 text-indigo-500" />
        <span>API 테스트 콘솔</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span>Interactive Predict Payload Tester</span>
                </h2>
                <p className="text-xs font-mono text-slate-500">
                  InferenceService: {name}
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Input Tensor JSON */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  입력 텐서 Payload (JSON)
                </label>
                <textarea
                  rows={10}
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-emerald-400 focus:outline-none"
                />
              </div>

              {/* Predict Output JSON */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    모델 예측 응답 Output
                  </label>
                  {testResult && (
                    <span className="text-[11px] font-mono text-emerald-600 font-semibold">
                      지연시간: {testResult.latencyMs}ms
                    </span>
                  )}
                </div>
                <div className="h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200">
                  {testMutation.isPending ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      <span>추론 계산 중...</span>
                    </div>
                  ) : testResult ? (
                    <pre className="whitespace-pre-wrap">
                      {JSON.stringify(testResult.output, null, 2)}
                    </pre>
                  ) : (
                    <span className="text-slate-600">
                      &apos;테스트 실행&apos; 버튼을 누르면 예측 결과 텐서가
                      출력됩니다.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                닫기
              </button>
              <button
                onClick={handleTest}
                disabled={testMutation.isPending}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {testMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>실행 중...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    <span>테스트 실행</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
