"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  RefreshCw,
  ShieldAlert,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeploymentIncident, listIncidents } from "@/lib/incidents-api";
import { IncidentRemediationDrawer } from "./incident-remediation-drawer";

interface IncidentAlertBannerProps {
  clusterId?: string;
  onIncidentsChange?: (incidents: DeploymentIncident[]) => void;
}

/**
 * 대시보드 상단 활성 배포 차단 인시던트 알림 배너
 *
 * 활성(ACTIVE) 상태의 배포 차단 인시던트가 감지되었을 때만 노출되며,
 * 클릭 시 3대 보조 복구 경로를 제공하는 IncidentRemediationDrawer를 트리거합니다.
 */
export function IncidentAlertBanner({
  clusterId,
  onIncidentsChange,
}: IncidentAlertBannerProps) {
  const [incidents, setIncidents] = useState<DeploymentIncident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] =
    useState<DeploymentIncident | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const fetchActiveIncidents = useCallback(async () => {
    try {
      const response = await listIncidents({
        status: "ACTIVE",
        clusterId,
        limit: 10,
      });
      setIncidents(response.items || []);
      onIncidentsChange?.(response.items || []);
    } catch {
      // 대시보드 메인 로딩을 방해하지 않도록 에러 격리
      setIncidents([]);
    } finally {
      setIsLoading(false);
    }
  }, [clusterId, onIncidentsChange]);

  useEffect(() => {
    void fetchActiveIncidents();

    // 15초 주기로 활성 인시던트 상태 폴링
    const timer = setInterval(() => {
      void fetchActiveIncidents();
    }, 15000);

    return () => clearInterval(timer);
  }, [fetchActiveIncidents]);

  if (isLoading || incidents.length === 0) {
    return null;
  }

  const primaryIncident = incidents[0];
  const totalCount = incidents.length;

  const handleOpenDrawer = (incident: DeploymentIncident) => {
    setSelectedIncident(incident);
    setIsDrawerOpen(true);
  };

  const handleResolved = () => {
    void fetchActiveIncidents();
  };

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 via-amber-50/70 to-rose-50 p-4 shadow-sm transition-all duration-200 animate-in fade-in">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-xs">
              <ShieldAlert className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-rose-600 text-white hover:bg-rose-700 text-xs px-2 py-0.5">
                  배포 차단 발생 ({totalCount}건)
                </Badge>
                <span className="font-semibold text-xs text-rose-950 truncate">
                  {primaryIncident.clusterId} · {primaryIncident.resourceKind}/
                  {primaryIncident.resourceName}
                </span>
              </div>
              <p className="mt-1 text-xs text-rose-800 line-clamp-1 leading-relaxed">
                Kyverno 정책{" "}
                <span className="font-semibold underline">
                  {primaryIncident.policyName}
                </span>
                에 의해 ArgoCD 배포가 차단되었습니다:{" "}
                {primaryIncident.blockReason}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
            {totalCount > 1 && (
              <span className="hidden text-xs text-slate-500 md:inline">
                외 {totalCount - 1}건
              </span>
            )}
            <Button
              size="sm"
              onClick={() => handleOpenDrawer(primaryIncident)}
              className="h-9 rounded-xl bg-rose-600 text-white hover:bg-rose-700 text-xs font-semibold shadow-xs gap-1.5"
            >
              <Zap className="size-3.5" />
              조치 가이드 확인
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <IncidentRemediationDrawer
        incident={selectedIncident}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onResolved={handleResolved}
      />
    </>
  );
}
