import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createNotebook,
  deleteNotebook,
  getNotebookPresets,
  getNotebooks,
  startNotebook,
  stopNotebook,
  CreateNotebookInput,
} from "@/lib/notebooks-api";
import { useSseSubscription } from "./use-sse-subscription";

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

  useSseSubscription<{
    clusterId: string;
    namespace: string;
    name?: string;
  }>({
    path: "/mlops/notebooks/events",
    queryParams: { clusterId, namespace },
    events: ["notebook-updated"],
    enabled: Boolean(clusterId),
    onMessage: () => {
      queryClient.invalidateQueries({
        queryKey: ["notebooks", clusterId, namespace],
      });
    },
  });
}

export function useNotebooks(clusterId: string, namespace: string = "default") {
  useNotebookEvents(clusterId, namespace);

  return useQuery({
    queryKey: ["notebooks", clusterId, namespace],
    queryFn: () => getNotebooks(clusterId, namespace),
    enabled: Boolean(clusterId),
    placeholderData: keepPreviousData,
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
