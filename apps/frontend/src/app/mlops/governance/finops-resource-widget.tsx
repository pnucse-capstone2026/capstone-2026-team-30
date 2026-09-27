"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MlGovernanceOverview } from "@/lib/ml-governance-api";
import {
  Cpu,
  DollarSign,
  HardDrive,
  PlayCircle,
  ShieldAlert,
  StopCircle,
} from "lucide-react";

type FinOpsResourceWidgetProps = {
  overview?: MlGovernanceOverview;
  isLoading?: boolean;
};

export function FinOpsResourceWidget({
  overview,
  isLoading,
}: FinOpsResourceWidgetProps) {
  if (isLoading || !overview) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <Card
            key={i}
            className="animate-pulse bg-slate-100 dark:bg-slate-800 h-32 rounded-xl"
          />
        ))}
      </div>
    );
  }

  const { gpuQuota, notebooks, costSavings, policyViolationsCount } = overview;

  return (
    <div className="space-y-6 mb-8">
      {/* 4 Key Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* GPU Quota Card */}
        <Card className="border-indigo-100 dark:border-indigo-900/40 bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-slate-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              GPU 쿼터 사용률
            </CardTitle>
            <HardDrive className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {gpuQuota.usedGpus} / {gpuQuota.totalLimit}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  GPUs
                </span>
              </div>
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                {gpuQuota.usagePercentage}%
              </span>
            </div>
            {/* Progress Bar */}
            <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className="bg-indigo-600 dark:bg-indigo-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${gpuQuota.usagePercentage}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Notebook State Counts Card */}
        <Card className="border-emerald-100 dark:border-emerald-900/40 bg-gradient-to-br from-emerald-50/50 to-white dark:from-emerald-950/20 dark:to-slate-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              노트북 실행 상태
            </CardTitle>
            <PlayCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {notebooks.active}{" "}
                <span className="text-xs text-muted-foreground">Active</span>
              </div>
              <div className="text-sm font-medium text-amber-500">
                {notebooks.idle}{" "}
                <span className="text-xs text-muted-foreground">Idle</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2 font-medium">
              전체 {notebooks.total}개 중 {notebooks.stopped}개 중지됨
            </p>
          </CardContent>
        </Card>

        {/* Cost Savings Card */}
        <Card className="border-cyan-100 dark:border-cyan-900/40 bg-gradient-to-br from-cyan-50/50 to-white dark:from-cyan-950/20 dark:to-slate-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              FinOps 추정 절감액
            </CardTitle>
            <DollarSign className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-600 dark:text-cyan-400">
              ${costSavings.estimatedMonthlySavingsUsd.toLocaleString()}
              <span className="text-xs font-normal text-muted-foreground">
                {" "}
                / 월
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              자동 중지된 {costSavings.autoStoppedCount}개 노트북 기준 (일 $
              {costSavings.estimatedDailySavingsUsd})
            </p>
          </CardContent>
        </Card>

        {/* Policy Compliance Card */}
        <Card className="border-rose-100 dark:border-rose-900/40 bg-gradient-to-br from-rose-50/50 to-white dark:from-rose-950/20 dark:to-slate-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">
              ML 거버넌스 위반
            </CardTitle>
            <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {policyViolationsCount}건
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {policyViolationsCount === 0
                ? "모든 ML 워크로드가 Kyverno 정책을 준수 중입니다."
                : "Kyverno 정책에 의해 감지된 ML 거버넌스 항목"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
