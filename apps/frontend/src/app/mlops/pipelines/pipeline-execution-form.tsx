"use client";

import { useState } from "react";
import {
  useCreatePipelineRun,
  usePipelineTemplates,
} from "@/hooks/use-pipelines";
import { Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PipelineExecutionFormProps {
  clusterId: string;
  namespace: string;
}

export function PipelineExecutionForm({
  clusterId,
  namespace,
}: PipelineExecutionFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(
    "pipe-resnet50-train",
  );
  const [runName, setRunName] = useState<string>("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({
    learning_rate: "0.001",
    batch_size: "32",
    dataset_uri: "s3://mlops-storage/datasets/cifar10",
  });

  const { data: templates = [] } = usePipelineTemplates(clusterId);
  const createRunMutation = useCreatePipelineRun();

  const selectedTemplate =
    templates.find((t) => t.id === selectedPipelineId) || templates[0];

  const handleTemplateChange = (pipelineId: string) => {
    setSelectedPipelineId(pipelineId);
    const tmpl = templates.find((t) => t.id === pipelineId);
    if (tmpl) {
      const initialParams: Record<string, string> = {};
      tmpl.parameters.forEach((p) => {
        initialParams[p.name] = p.defaultValue || "";
      });
      setParamValues(initialParams);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalRunName =
      runName.trim() || `${selectedPipelineId}-run-${Date.now().toString(36)}`;

    try {
      await createRunMutation.mutateAsync({
        pipelineId: selectedPipelineId,
        runName: finalRunName,
        parameters: paramValues,
        clusterId,
        namespace,
      });
      toast.success(
        `파이프라인 실행 '${finalRunName}'이 성공적으로 제출되었습니다.`,
      );
      setIsOpen(false);
      setRunName("");
    } catch {
      toast.error("파이프라인 실행 제출 중 오류가 발생했습니다.");
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
      >
        <Play className="h-4 w-4" />
        <span>파이프라인 실행</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">
                새 파이프라인 실행 제출
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  대상 파이프라인 템플릿
                </label>
                <select
                  value={selectedPipelineId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  {templates.length === 0 && (
                    <option value="pipe-resnet50-train">
                      ResNet-50 Image Classification Pipeline
                    </option>
                  )}
                </select>
                {selectedTemplate && (
                  <p className="mt-1 text-xs text-slate-500">
                    {selectedTemplate.description}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  실행(Run) 이름
                </label>
                <input
                  type="text"
                  placeholder="예: resnet50-train-run-20260827"
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none font-mono"
                />
              </div>

              {/* Dynamic Hyperparameters & Dataset Path inputs */}
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  자동 동기화 하이퍼파라미터 & 데이터셋 경로
                </h4>
                {selectedTemplate?.parameters.map((param) => (
                  <div key={param.name}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-mono font-medium text-slate-700">
                        {param.name}
                      </span>
                      {param.description && (
                        <span className="text-[11px] text-slate-500">
                          {param.description}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={paramValues[param.name] ?? ""}
                      onChange={(e) =>
                        setParamValues({
                          ...paramValues,
                          [param.name]: e.target.value,
                        })
                      }
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={createRunMutation.isPending}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {createRunMutation.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>제출 중...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      <span>실행 제출</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
