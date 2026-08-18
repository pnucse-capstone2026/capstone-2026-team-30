"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useDeleteNotebook,
  useStartNotebook,
  useStopNotebook,
} from "@/hooks/use-notebooks";
import { NotebookItem, getNotebookUrl } from "@/lib/notebooks-api";
import { ExternalLink, Loader2, Play, Square, Trash2 } from "lucide-react";

type NotebookActionsProps = {
  notebook: NotebookItem;
};

export function NotebookActions({ notebook }: NotebookActionsProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const startMutation = useStartNotebook();
  const stopMutation = useStopNotebook();
  const deleteMutation = useDeleteNotebook();

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const res = await getNotebookUrl(
        notebook.name,
        notebook.clusterId,
        notebook.namespace,
      );
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch {
      alert("노트북 접속 URL을 조율하는 중 오류가 발생했습니다.");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleStart = () => {
    startMutation.mutate({
      name: notebook.name,
      clusterId: notebook.clusterId,
      namespace: notebook.namespace,
    });
  };

  const handleStop = () => {
    stopMutation.mutate({
      name: notebook.name,
      clusterId: notebook.clusterId,
      namespace: notebook.namespace,
    });
  };

  const handleDelete = () => {
    if (
      confirm(
        `노트북 '${notebook.name}'을(를) 정말로 삭제하시겠습니까?\n저장되지 않은 메모리는 손실될 수 있습니다.`,
      )
    ) {
      deleteMutation.mutate({
        name: notebook.name,
        clusterId: notebook.clusterId,
        namespace: notebook.namespace,
      });
    }
  };

  const isPending =
    startMutation.isPending ||
    stopMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div className="flex items-center gap-2">
      {notebook.status === "Running" && (
        <>
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting || isPending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
          >
            {isConnecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
            접속 (Connect)
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleStop}
            disabled={isPending}
            className="gap-1 text-amber-600 border-amber-500/30 hover:bg-amber-50"
          >
            {stopMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5 fill-current" />
            )}
            중지
          </Button>
        </>
      )}

      {notebook.status === "Stopped" && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleStart}
          disabled={isPending}
          className="gap-1 text-emerald-600 border-emerald-500/30 hover:bg-emerald-50"
        >
          {startMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
          시작
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        onClick={handleDelete}
        disabled={isPending}
        className="text-zinc-500 hover:text-red-600 hover:bg-red-50 p-2"
        title="노트북 삭제"
      >
        {deleteMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
