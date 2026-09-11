"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NotebookItem } from "@/lib/notebooks-api";
import { useAuthStore } from "@/lib/auth-store";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Sparkles,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

type NotebookConnectDialogProps = {
  notebook: NotebookItem;
  isOpen: boolean;
  onClose: () => void;
  clusterId?: string;
};

export function NotebookConnectDialog({
  notebook,
  isOpen,
  onClose,
}: NotebookConnectDialogProps) {
  const [copied, setCopied] = useState(false);
  const [showPortForward, setShowPortForward] = useState(false);

  const accessToken = useAuthStore((state) => state.accessToken);
  const directUrl = `/notebook/${notebook.namespace}/${notebook.name}/lab${accessToken ? `?token=${encodeURIComponent(accessToken)}` : ""}`;
  const portForwardCmd = `./scripts/bin/kubectl port-forward svc/${notebook.name} 8888:80 -n ${notebook.namespace}`;
  const localUrl = `http://localhost:8888/notebook/${notebook.namespace}/${notebook.name}/lab`;

  const handleOpenDirectJupyter = () => {
    window.open(directUrl, "_blank", "noopener,noreferrer");
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(portForwardCmd);
      setCopied(true);
      toast.success("포트포워딩 명령어가 클립보드에 복사되었습니다.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("클립보드 복사에 실패했습니다.");
    }
  };

  const handleOpenLocalJupyter = () => {
    window.open(localUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-hidden flex flex-col p-5 gap-3">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <BookOpen className="h-4 w-4 text-indigo-600" />
            <span>노트북 워크스페이스 접속</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Kubernetes 클러스터 내부의 JupyterLab IDE 워크스페이스에 안전하게
            연결합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1 text-xs overflow-y-auto pr-1 flex-1">
          {/* 노트북 메타 정보 카드 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-xs truncate max-w-[240px]">
                {notebook.name}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium text-[10px]">
                {notebook.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-slate-600 text-[11px]">
              <div>
                <span className="text-slate-400">네임스페이스: </span>
                <span className="font-mono">{notebook.namespace}</span>
              </div>
              <div>
                <span className="text-slate-400">사양: </span>
                <span>
                  CPU {notebook.cpuLimit} / RAM {notebook.memoryLimit}
                </span>
              </div>
            </div>
            <div className="text-slate-500 font-mono text-[11px] truncate">
              <span className="text-slate-400">이미지: </span>
              {notebook.image}
            </div>
          </div>

          {/* 1. 웹 브라우저 원클릭 바로 접속 (추천) */}
          <div className="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white p-3 space-y-2 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-950 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />웹 브라우저
                원클릭 접속 (인앱 리버스 프록시)
              </span>
              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-medium">
                추천 (No-CLI)
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              kubectl 설치나 로컬 포트포워딩 없이, 플랫폼 인앱 프록시를 통해 새
              탭에서 JupyterLab IDE를 바로 실행합니다.
            </p>
            <Button
              type="button"
              onClick={handleOpenDirectJupyter}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2 text-xs font-medium py-2 h-9 shadow-sm"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>JupyterLab 워크스페이스 바로 열기</span>
            </Button>
          </div>

          {/* 2. 로컬 터미널 포트포워딩 (선택사항) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 space-y-2">
            <button
              type="button"
              onClick={() => setShowPortForward(!showPortForward)}
              className="flex items-center justify-between w-full text-xs font-semibold text-slate-700 hover:text-slate-900 transition"
            >
              <span className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-slate-500" />
                CLI 개발자를 위한 kubectl 포트포워딩 방식 (선택)
              </span>
              {showPortForward ? (
                <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>

            {showPortForward && (
              <div className="space-y-2 pt-1 border-t border-slate-200">
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-500">
                    로컬 터미널에서 아래 명령어 실행:
                  </span>
                  <div className="relative flex items-center">
                    <pre className="w-full rounded-md bg-slate-900 px-3 py-2 pr-10 font-mono text-[11px] text-emerald-400 overflow-x-auto select-all break-all whitespace-pre-wrap">
                      {portForwardCmd}
                    </pre>
                    <button
                      type="button"
                      onClick={handleCopyCommand}
                      className="absolute right-2 top-2 rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 hover:text-white transition"
                      title="명령어 복사"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenLocalJupyter}
                  className="w-full gap-1.5 text-xs text-slate-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>로컬 localhost:8888 열기</span>
                </Button>
              </div>
            )}
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed bg-indigo-50/60 p-2 rounded border border-indigo-100">
            💡 <strong>영구 스토리지 보존:</strong> 작업 중인 모든 소스코드와
            데이터셋은{" "}
            <code className="font-mono text-indigo-700">/home/jovyan/work</code>{" "}
            (AWS EBS PVC)에 자동 저장되어 안전하게 유지됩니다.
          </p>
        </div>

        <DialogFooter className="pt-2 border-t border-slate-100 flex items-center justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            className="text-xs h-8 px-3"
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
