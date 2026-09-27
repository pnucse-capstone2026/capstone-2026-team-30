"use client";

import { useState } from "react";
import { useDeployModel } from "@/hooks/use-serving";
import { Server, Loader2, Cpu } from "lucide-react";
import { toast } from "sonner";

interface DeployModelDialogProps {
  clusterId: string;
  namespace: string;
}

export function DeployModelDialog({
  clusterId,
  namespace,
}: DeployModelDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [framework, setFramework] = useState<
    "pytorch" | "onnx" | "tensorflow" | "sklearn"
  >("pytorch");
  const [storageUri, setStorageUri] = useState("s3://ml-models/resnet50/v1");
  const [minReplicas, setMinReplicas] = useState(1);
  const [maxReplicas, setMaxReplicas] = useState(3);
  const [canaryPercent, setCanaryPercent] = useState(100);

  const deployMutation = useDeployModel();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("모델 서빙 이름을 입력해 주세요.");
      return;
    }

    try {
      await deployMutation.mutateAsync({
        name: name.trim().toLowerCase(),
        framework,
        storageUri: storageUri.trim(),
        minReplicas,
        maxReplicas,
        canaryTrafficPercent: canaryPercent,
        clusterId,
        namespace,
      });
      toast.success(`KServe InferenceService '${name}' 배포가 완료되었습니다.`);
      setIsOpen(false);
      setName("");
    } catch {
      toast.error("모델 배포 처리 중 오류가 발생했습니다.");
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-emerald-700 transition-colors"
      >
        <Server className="h-4 w-4" />
        <span>신규 모델 배포</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Server className="h-5 w-5 text-emerald-600" />
                <span>KServe 모델 배포 (InferenceService)</span>
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
                  서빙 엔드포인트 명칭
                </label>
                <input
                  type="text"
                  placeholder="예: resnet50-v1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    타겟 프레임워크
                  </label>
                  <select
                    value={framework}
                    onChange={(e) => setFramework(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none font-medium"
                  >
                    <option value="pytorch">PyTorch (.pt)</option>
                    <option value="onnx">ONNX (.onnx)</option>
                    <option value="tensorflow">TensorFlow SavedModel</option>
                    <option value="sklearn">Scikit-Learn (.pkl)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    초기 Canary 트래픽 (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={canaryPercent}
                    onChange={(e) => setCanaryPercent(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  S3 / MinIO 모델 아티팩트 URI
                </label>
                <input
                  type="text"
                  placeholder="s3://bucket/path/model.pt"
                  value={storageUri}
                  onChange={(e) => setStorageUri(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>

              {/* Replica Autoscale & Scale-to-Zero settings */}
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
                  <Cpu className="h-4 w-4 text-emerald-600" />
                  <span>오토스케일링 & Scale-to-Zero 설정</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Min Replicas (0 = Scale to Zero)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={minReplicas}
                      onChange={(e) => setMinReplicas(Number(e.target.value))}
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-600 mb-1">
                      Max Replicas
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={maxReplicas}
                      onChange={(e) => setMaxReplicas(Number(e.target.value))}
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
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
                  disabled={deployMutation.isPending}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {deployMutation.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>배포 중...</span>
                    </>
                  ) : (
                    <>
                      <Server className="h-3.5 w-3.5" />
                      <span>서빙 엔드포인트 생성</span>
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
