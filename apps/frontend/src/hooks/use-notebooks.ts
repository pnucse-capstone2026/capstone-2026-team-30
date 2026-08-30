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
  NotebookItem,
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
 * TanStack Query 캐시를 직접 갱신(Direct Cache Update)하는 훅입니다.
 */
export function useNotebookEvents(
  clusterId: string,
  namespace: string = "default",
) {
  const queryClient = useQueryClient();

  useSseSubscription<{
    action?: "ADDED" | "MODIFIED" | "DELETED";
    notebook?: NotebookItem;
    clusterId: string;
    namespace: string;
  }>({
    path: "/mlops/notebooks/events",
    queryParams: { clusterId, namespace },
    events: ["notebook-updated"],
    enabled: Boolean(clusterId),
    onMessage: (data) => {
      const targetKey = ["notebooks", clusterId, namespace];

      if (data?.notebook?.name && data?.action) {
        // SSE 이벤트를 통해 전달된 Notebook 객체로 캐시를 직접 업데이트하여 불필요한 HTTP 재요청을 방지함
        queryClient.setQueryData<NotebookItem[]>(targetKey, (old = []) => {
          if (data.action === "DELETED") {
            return old.filter((item) => item.name !== data.notebook?.name);
          }
          const exists = old.some((item) => item.name === data.notebook?.name);
          if (exists) {
            return old.map((item) =>
              item.name === data.notebook?.name ? data.notebook! : item,
            );
          }
          return [...old, data.notebook!];
        });
      } else {
        queryClient.invalidateQueries({ queryKey: targetKey });
      }
    },
  });
}

export function useNotebooks(clusterId: string, namespace: string = "default") {
  useNotebookEvents(clusterId, namespace);

  return useQuery({
    queryKey: ["notebooks", clusterId, namespace],
    queryFn: () => getNotebooks(clusterId, namespace),
    enabled: Boolean(clusterId),
    staleTime: 1000 * 60 * 5, // 5분 동안 캐시 데이터를 fresh 상태로 유지하여 무분별한 리페치 방지
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
