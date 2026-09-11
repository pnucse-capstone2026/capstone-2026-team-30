"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateNotebook, useNotebookPresets } from "@/hooks/use-notebooks";
import { PlusCircle, Loader2, Cpu, HardDrive, Layers } from "lucide-react";

type CreateNotebookDialogProps = {
  clusterId: string;
  namespace?: string;
};

export function CreateNotebookDialog({
  clusterId,
  namespace = "default",
}: CreateNotebookDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hardwareTier, setHardwareTier] = useState("CPU_SMALL");
  const [frameworkImage, setFrameworkImage] = useState("JUPYTER_PYTORCH");
  const [specMode, setSpecMode] = useState<"preset" | "custom">("preset");
  const [customCpu, setCustomCpu] = useState(2);
  const [customMemoryGb, setCustomMemoryGb] = useState(4);
  const [customGpu, setCustomGpu] = useState(0);
  const [storageGb, setStorageGb] = useState(10);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: presets, isLoading: isPresetsLoading } = useNotebookPresets();
  const createMutation = useCreateNotebook();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!name.trim()) {
      setErrorMsg("노트북 명칭을 입력해주세요.");
      return;
    }

    if (specMode === "preset") {
      const selectedTier = presets?.hardwareTiers.find(
        (t) => t.id === hardwareTier,
      );
      if (selectedTier && selectedTier.isAvailable === false) {
        setErrorMsg(
          selectedTier.disabledReason ||
            "선택하신 하드웨어 사양은 현재 클러스터에서 지원되지 않습니다.",
        );
        return;
      }
    } else if (specMode === "custom") {
      if (customGpu > 0) {
        setErrorMsg(
          "현재 클러스터(프리티어/CPU 전용)에서는 GPU 가속기를 지원하지 않습니다.",
        );
        return;
      }
    }

    try {
      await createMutation.mutateAsync({
        name: name.trim().toLowerCase(),
        clusterId,
        namespace,
        hardwareTier: specMode === "custom" ? "CUSTOM" : hardwareTier,
        frameworkImage,
        storageGb,
        ...(specMode === "custom"
          ? {
              customCpu,
              customMemoryGb,
              customGpu,
            }
          : {}),
      });

      setOpen(false);
      setName("");
      setSpecMode("preset");
      setHardwareTier("CPU_SMALL");
      setCustomCpu(2);
      setCustomMemoryGb(4);
      setCustomGpu(0);
      setFrameworkImage("JUPYTER_PYTORCH");
      setStorageGb(10);
    } catch (err: any) {
      setErrorMsg(
        err.message || "노트북 프로비저닝 요청 중 오류가 발생했습니다.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <PlusCircle className="h-4 w-4" />새 노트북 생성
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Layers className="h-5 w-5 text-indigo-500" />
              JupyterLab / RStudio 개발 환경 프로비저닝
            </DialogTitle>
            <DialogDescription>
              Kubernetes 복잡성 없이 간편하게 격리된 MLOps 노트북 인스턴스를
              프로비저닝합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-4">
            {errorMsg && (
              <div className="p-3 text-sm rounded-md bg-red-500/10 text-red-600 border border-red-500/20">
                {errorMsg}
              </div>
            )}

            {/* 1. 노트북 명칭 */}
            <div className="grid gap-2">
              <Label htmlFor="notebook-name" className="font-semibold">
                1. 노트북 인스턴스 이름
              </Label>
              <Input
                id="notebook-name"
                placeholder="e.g. pytorch-experiment-01"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                소문자, 숫자, 하이픈(-)만 포함 가능합니다.
              </p>
            </div>

            {/* 2. 하드웨어 리소스 사양 설정 (프리셋 / 직접 입력 모드) */}
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label className="font-semibold flex items-center gap-1.5">
                  <Cpu className="h-4 w-4 text-indigo-500" />
                  2. 하드웨어 사양
                </Label>
                <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setSpecMode("preset")}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      specMode === "preset"
                        ? "bg-white text-slate-900 shadow-xs font-semibold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    기본 프리셋
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpecMode("custom")}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      specMode === "custom"
                        ? "bg-white text-slate-900 shadow-xs font-semibold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    직접 입력 (Custom Spec)
                  </button>
                </div>
              </div>

              {specMode === "preset" ? (
                isPresetsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> 프리셋 로딩
                    중...
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {presets?.hardwareTiers.map((tier) => {
                      const isDisabled = tier.isAvailable === false;
                      return (
                        <label
                          key={tier.id}
                          className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                            isDisabled
                              ? "opacity-60 bg-slate-100/70 border-slate-200 cursor-not-allowed text-slate-500"
                              : hardwareTier === tier.id
                                ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500 cursor-pointer"
                                : "border-border hover:bg-muted/50 cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="radio"
                              name="hardwareTier"
                              value={tier.id}
                              checked={hardwareTier === tier.id}
                              disabled={isDisabled}
                              onChange={(e) =>
                                !isDisabled && setHardwareTier(e.target.value)
                              }
                              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <p
                                  className={`text-sm font-medium ${
                                    isDisabled
                                      ? "text-slate-600 line-through decoration-slate-400"
                                      : ""
                                  }`}
                                >
                                  {tier.name}
                                </p>
                                {isDisabled && (
                                  <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                    지원 불가 (미구성)
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Limit: CPU {tier.cpuLimit} / RAM{" "}
                                {tier.memoryLimit}
                                {tier.isGpuRequired &&
                                  ` / GPU ${tier.gpuLimit}ea`}
                              </p>
                              {isDisabled && tier.disabledReason && (
                                <p className="text-[11px] text-amber-700 mt-0.5 font-medium">
                                  ⚠️ {tier.disabledReason}
                                </p>
                              )}
                            </div>
                          </div>

                          {tier.isGpuRequired && (
                            <span
                              className={`px-2 py-0.5 text-xs font-semibold rounded ${
                                isDisabled
                                  ? "bg-slate-200/80 text-slate-400 border border-slate-300"
                                  : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                              }`}
                            >
                              NVIDIA GPU
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/30 space-y-4">
                  {/* CPU 코어 수 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">
                        CPU 코어 수:{" "}
                        <span className="text-indigo-600 font-bold">
                          {customCpu} Cores
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        1 ~ 4 Cores (프리티어 노드 한도)
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={4}
                      step={1}
                      value={customCpu}
                      onChange={(e) => setCustomCpu(Number(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  {/* 메모리 크기 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">
                        메모리 (RAM):{" "}
                        <span className="text-indigo-600 font-bold">
                          {customMemoryGb} GB
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        2 ~ 8 GB (프리티어 노드 한도)
                      </span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={8}
                      step={1}
                      value={customMemoryGb}
                      onChange={(e) =>
                        setCustomMemoryGb(Number(e.target.value))
                      }
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />
                  </div>

                  {/* GPU 개수 (프리티어 미지원) */}
                  <div className="space-y-1.5 p-3 rounded-lg border border-amber-200/70 bg-amber-50/40">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <span className="text-amber-900">
                          NVIDIA GPU 가속기
                        </span>
                        <span className="text-[10px] bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded font-medium">
                          프리티어 미지원
                        </span>
                      </span>
                      <span className="text-slate-500 font-bold">
                        사용 안 함 (0)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-tight">
                      현재 EKS 클러스터(t3/m5 CPU 노드)는 프리티어 환경으로 GPU
                      하드웨어가 구성되어 있지 않습니다.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setCustomGpu(0)}
                        className="flex-1 py-1.5 rounded-lg border text-xs font-semibold border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500 cursor-default"
                      >
                        None (CPU 전용)
                      </button>
                      {[1, 2, 4].map((g) => (
                        <button
                          key={g}
                          type="button"
                          disabled
                          title="현재 클러스터에 GPU 노드가 없어 선택할 수 없습니다."
                          className="flex-1 py-1.5 rounded-lg border text-xs font-medium border-slate-200 bg-slate-100/80 text-slate-400 cursor-not-allowed opacity-50 line-through"
                        >
                          {g} GPU
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-indigo-100/60 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>적용 사양:</span>
                    <span>
                      CPU {customCpu} Core / RAM {customMemoryGb}GiB (CPU 전용)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 3. ML 프레임워크 & 런타임 이미지 */}
            <div className="grid gap-2">
              <Label className="font-semibold">3. ML 프레임워크 & 런타임</Label>
              <div className="grid grid-cols-1 gap-2">
                {presets?.frameworkImages.map((fw) => (
                  <label
                    key={fw.id}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                      frameworkImage === fw.id
                        ? "border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="frameworkImage"
                        value={fw.id}
                        checked={frameworkImage === fw.id}
                        onChange={(e) => setFrameworkImage(e.target.value)}
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-sm font-medium">{fw.name}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[340px]">
                          {fw.image}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">
                      {fw.type}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* 4. 영구 스토리지 용량 설정 */}
            <div className="grid gap-2">
              <Label
                htmlFor="storage-size"
                className="font-semibold flex items-center gap-1.5"
              >
                <HardDrive className="h-4 w-4 text-indigo-500" />
                4. 홈 영구 스토리지 용량 (/home/jovyan/work)
              </Label>
              <div className="flex items-center gap-3">
                <Input
                  id="storage-size"
                  type="number"
                  min={5}
                  max={500}
                  value={storageGb}
                  onChange={(e) => setStorageGb(Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">
                  GB (Persistent Volume Claim)
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createMutation.isPending}
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || isPresetsLoading}
              className="gap-2"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              노트북 프로비저닝 시작
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
