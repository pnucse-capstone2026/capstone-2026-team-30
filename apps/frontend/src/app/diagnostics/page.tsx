"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, FlaskConical, Loader2, Sparkles } from "lucide-react";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/auth-store";

export default function DiagnosticsRedirectPage() {
  const user = useAuthStore((state) => state.user);
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/simulation");
    }, 1500);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <ProtectedRoute>
      <DashboardPageShell
        title="Enforce 차단 AI 진단"
        description="통합 거버넌스 샌드박스로 자동 전환됩니다."
        variant={user?.role === "ADMIN" ? "admin" : "user"}
        activeHref="/simulation"
      >
        <div className="flex min-h-[500px] items-center justify-center p-6">
          <Card className="max-w-md border-indigo-200 bg-white shadow-md text-center">
            <CardHeader className="pb-3">
              <div className="mx-auto rounded-2xl bg-indigo-50 p-3.5 text-indigo-600 w-fit mb-2 border border-indigo-200">
                <Sparkles className="size-8" />
              </div>
              <CardTitle className="text-base font-bold text-slate-900">
                통합 랩으로 기능 이전 완료
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              <p className="text-xs text-slate-600 leading-relaxed">
                &apos;Enforce 차단 AI 진단&apos; 기능이{" "}
                <strong>정책 시뮬레이션 & AI 진단 랩</strong>으로
                통합되었습니다. 이제 한 화면에서 사전 검증(Fast-Fail/Dry-Run)과
                실시간 배포 시뮬레이션을 모두 이용하실 수 있습니다.
              </p>

              <div className="flex items-center justify-center gap-2 text-xs text-indigo-700 font-medium py-1">
                <Loader2 className="size-4 animate-spin" />
                <span>잠시 후 통합 랩으로 자동 이동합니다...</span>
              </div>

              <div className="pt-2">
                <Link href="/simulation">
                  <Button className="w-full gap-2 bg-gradient-to-r from-indigo-600 to-cyan-600 text-white font-medium text-xs shadow-sm hover:from-indigo-500 hover:to-cyan-500">
                    <FlaskConical className="size-3.5" />
                    정책 시뮬레이션 & AI 진단 랩 바로가기
                    <ArrowRight className="size-3.5" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardPageShell>
    </ProtectedRoute>
  );
}
