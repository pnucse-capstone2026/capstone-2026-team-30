"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MlPolicyViolation } from "@/lib/ml-governance-api";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

type MlPolicyCompliancePanelProps = {
  violations: MlPolicyViolation[];
  isLoading?: boolean;
};

export function MlPolicyCompliancePanel({
  violations,
  isLoading,
}: MlPolicyCompliancePanelProps) {
  const getSeverityBadge = (severity: MlPolicyViolation["severity"]) => {
    switch (severity) {
      case "critical":
        return <Badge variant="destructive">Critical</Badge>;
      case "high":
        return <Badge className="bg-rose-500 text-white">High</Badge>;
      case "medium":
        return <Badge className="bg-amber-500 text-white">Medium</Badge>;
      default:
        return <Badge variant="secondary">Low</Badge>;
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <CardTitle className="text-lg font-semibold">
            ML Policy Compliance Panel
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Kyverno Engine Active
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          Total: {violations.length} Violation(s)
        </span>
      </CardHeader>

      <CardContent className="pt-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg"
              />
            ))}
          </div>
        ) : violations.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500 mb-2" />
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              정책 위반 항목이 없습니다
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              모든 ML 노트북 및 학습 작업이 Kyverno GPU 한도, Spot 노드 주입 및
              레지스트리 보안 정책을 준수하고 있습니다.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {violations.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 hover:border-indigo-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {item.policyName}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      ({item.ruleName})
                    </span>
                  </div>
                  {getSeverityBadge(item.severity)}
                </div>

                <p className="text-xs text-slate-700 dark:text-slate-300">
                  {item.message}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                  <div className="flex items-center gap-3 text-slate-500 font-mono">
                    <span>
                      Target: {item.resourceKind}/{item.resourceName}
                    </span>
                    <span>ns: {item.namespace}</span>
                  </div>

                  <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-1 rounded-md">
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span className="font-medium">{item.remediation}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
