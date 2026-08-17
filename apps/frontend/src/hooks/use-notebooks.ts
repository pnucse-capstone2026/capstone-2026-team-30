import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useNotebooks(clusterId: string, namespace: string = "default") {
  return useQuery({
    queryKey: ["notebooks", clusterId, namespace],
    queryFn: () => getNotebooks(clusterId, namespace),
    enabled: Boolean(clusterId),
    refetchInterval: 5000, // 5초 주기 자동 갱신
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
