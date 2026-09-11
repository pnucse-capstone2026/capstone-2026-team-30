"use client";

import { useSystemModules } from "@/lib/system-modules";
import { ModuleDisabledNotice } from "@/components/ui/module-disabled-notice";

/**
 * MLOps 하위 모든 라우트(/mlops/*)에 대한 모듈 활성화 가드 레이아웃
 */
export default function MlopsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isModuleEnabled, isLoading } = useSystemModules();
  const mlopsEnabled = isModuleEnabled("mlops");

  // 모듈 조회가 완료되었고 MLOps가 비활성화된 경우 차단 안내 화면 표출
  if (!isLoading && !mlopsEnabled) {
    return (
      <main className="flex-1 overflow-y-auto bg-slate-950">
        <ModuleDisabledNotice
          moduleId="mlops"
          title="MLOps 플랫폼 비활성화 알림"
          description="현재 배포된 클러스터 환경에서는 MLOps(노트북, 파이프라인, KServe) 컴포넌트가 비활성화되어 있습니다."
        />
      </main>
    );
  }

  return <>{children}</>;
}
