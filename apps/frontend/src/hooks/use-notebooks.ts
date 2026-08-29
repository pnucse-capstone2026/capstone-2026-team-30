import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/lib/auth-api";
import { useAuthStore } from "@/lib/auth-store";
import {
  createNotebook,
  deleteNotebook,
  getNotebookPresets,
  getNotebooks,
  startNotebook,
  stopNotebook,
  CreateNotebookInput,
} from "@/lib/notebooks-api";

export function useNotebookPresets() {
  return useQuery({
    queryKey: ["notebook-presets"],
    queryFn: () => getNotebookPresets(),
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}

/**
 * 백엔드 K8s Watcher 및 SSE 엔드포인트를 연결/구독하여 실시간 Notebook 상태 변경 이벤트를 수신하고
 * TanStack Query 캐시를 동기화(invalidate)하는 훅입니다.
 */
export function useNotebookEvents(
  clusterId: string,
  namespace: string = "default",
) {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    if (!clusterId) return;

    const query = new URLSearchParams({
      clusterId,
      namespace,
      ...(accessToken ? { token: accessToken } : {}),
    });

    const sseUrl = `${API_BASE_URL}/mlops/notebooks/events?${query.toString()}`;
    const eventSource = new EventSource(sseUrl);

    eventSource.addEventListener("notebook-updated", () => {
      queryClient.invalidateQueries({
        queryKey: ["notebooks", clusterId, namespace],
      });
    });

    return () => {
      eventSource.close();
    };
  }, [clusterId, namespace, accessToken, queryClient]);
}

export function useNotebooks(clusterId: string, namespace: string = "default") {
  useNotebookEvents(clusterId, namespace);

  return useQuery({
    queryKey: ["notebooks", clusterId, namespace],
    queryFn: () => getNotebooks(clusterId, namespace),
    enabled: Boolean(clusterId),
  });
}

export function useCreateNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNotebookInput) => createNotebook(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "notebooks",
          variables.clusterId,
          variables.namespace || "default",
        ],
      });
    },
  });
}

export function useStopNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      clusterId,
      namespace = "default",
    }: {
      name: string;
      clusterId: string;
      namespace?: string;
    }) => stopNotebook(name, clusterId, namespace),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "notebooks",
          variables.clusterId,
          variables.namespace || "default",
        ],
      });
    },
  });
}

export function useStartNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      clusterId,
      namespace = "default",
    }: {
      name: string;
      clusterId: string;
      namespace?: string;
    }) => startNotebook(name, clusterId, namespace),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "notebooks",
          variables.clusterId,
          variables.namespace || "default",
        ],
      });
    },
  });
}

export function useDeleteNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      clusterId,
      namespace = "default",
    }: {
      name: string;
      clusterId: string;
      namespace?: string;
    }) => deleteNotebook(name, clusterId, namespace),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [
          "notebooks",
          variables.clusterId,
          variables.namespace || "default",
        ],
      });
    },
  });
}
