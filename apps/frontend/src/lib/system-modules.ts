import { create } from "zustand";
import { useEffect } from "react";
import { API_BASE_URL } from "./auth-api";

/**
 * 플랫폼 모듈 식별자 타입
 */
export type PlatformModuleId =
  | "core"
  | "mlops"
  | "aiAgent"
  | "simulation"
  | "gitops";

/**
 * 모듈 메타데이터 구조
 */
export type ModuleMetadata = {
  id: PlatformModuleId;
  name: string;
  description: string;
  enabled: boolean;
  required: boolean;
};

export type SystemModulesResponse = {
  modules: Record<PlatformModuleId, ModuleMetadata>;
};

const DEFAULT_MODULES: Record<PlatformModuleId, ModuleMetadata> = {
  core: {
    id: "core",
    name: "Core Governance",
    description: "Kyverno 정책 엔진 및 플랫폼 핵심 기능",
    enabled: true,
    required: true,
  },
  mlops: {
    id: "mlops",
    name: "MLOps Platform",
    description: "Kubeflow 노트북, 파이프라인, 서빙 및 GPU 거버넌스",
    enabled: true,
    required: false,
  },
  aiAgent: {
    id: "aiAgent",
    name: "AI Policy Assistant",
    description: "AI 정책 진단 및 지능형 코파일럿",
    enabled: true,
    required: false,
  },
  simulation: {
    id: "simulation",
    name: "Policy Simulation Lab",
    description: "정책 Dry-run 시뮬레이션 샌드박스",
    enabled: true,
    required: false,
  },
  gitops: {
    id: "gitops",
    name: "GitOps Policy Sync",
    description: "GitOps PR 자동 연동 및 정책 형상 관리",
    enabled: true,
    required: false,
  },
};

type SystemModulesState = {
  modules: Record<PlatformModuleId, ModuleMetadata>;
  isLoading: boolean;
  error: string | null;
  fetched: boolean;
  fetchModules: () => Promise<void>;
  isModuleEnabled: (moduleId: PlatformModuleId | string) => boolean;
};

export const useSystemModulesStore = create<SystemModulesState>((set, get) => ({
  modules: DEFAULT_MODULES,
  isLoading: false,
  error: null,
  fetched: false,

  fetchModules: async () => {
    // 중복 네트워크 호출 방지
    if (get().isLoading) return;
    set({ isLoading: true, error: null });

    try {
      const response = await fetch(`${API_BASE_URL}/system/modules`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`시스템 모듈 조회 실패: HTTP ${response.status}`);
      }

      const data: SystemModulesResponse = await response.json();
      if (data && data.modules) {
        set({
          modules: { ...DEFAULT_MODULES, ...data.modules },
          isLoading: false,
          fetched: true,
        });
      } else {
        set({ isLoading: false, fetched: true });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      // 네트워크 에러 시에도 기본값을 유지하여 UI 중단 방지
      set({
        error: errorMessage,
        isLoading: false,
        fetched: true,
      });
    }
  },

  isModuleEnabled: (moduleId: PlatformModuleId | string) => {
    const mod = get().modules[moduleId as PlatformModuleId];
    return mod ? mod.enabled : true;
  },
}));

/**
 * 플랫폼 모듈 활성화 상태를 조회하고 동적 네비게이션 및 가드를 지원하는 훅
 */
export function useSystemModules() {
  const { modules, isLoading, error, fetched, fetchModules, isModuleEnabled } =
    useSystemModulesStore();

  useEffect(() => {
    if (!fetched && !isLoading) {
      void fetchModules();
    }
  }, [fetched, isLoading, fetchModules]);

  return {
    modules,
    isLoading,
    error,
    isModuleEnabled,
    refetch: fetchModules,
  };
}
