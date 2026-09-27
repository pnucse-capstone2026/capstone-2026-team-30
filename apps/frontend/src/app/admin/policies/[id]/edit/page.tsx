"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ShieldAlert } from "lucide-react";

import { PolicyForm } from "@/app/admin/policies/policy-form";
import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { getPolicyById, type KyvernoPolicy } from "@/lib/policies";

/**
 * 관리자용 정책 수정 페이지 컴포넌트입니다.
 * URL 파라미터에서 정책 ID를 디코딩하여 실시간 정책 상세 정보를 조회한 뒤 수정 폼을 렌더링합니다.
 */
export default function AdminPolicyEditPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(params.id) : "";

  const [policy, setPolicy] = useState<KyvernoPolicy | null>(null);
  const [loading, setLoading] = useState(true);

  const initializeAuth = useAuthStore((state) => state.initialize);

  const loadPolicy = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      await initializeAuth();
      const detail = await getPolicyById(id);
      setPolicy(detail);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, initializeAuth]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  if (loading) {
    return (
      <DashboardPageShell
        variant="admin"
        activeHref="/admin/policies"
        title="정책 수정"
        description="정책 정보를 불러오는 중입니다..."
        actions={
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
          >
            <Link href="/admin/policies">
              <ArrowLeft className="size-4" />
              목록
            </Link>
          </Button>
        }
      >
        <div className="space-y-6">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </DashboardPageShell>
    );
  }

  if (!policy) {
    return (
      <DashboardPageShell
        variant="admin"
        activeHref="/admin/policies"
        title="정책을 찾을 수 없습니다"
        description="요청하신 정책 정보를 불러올 수 없습니다."
        actions={
          <Button
            asChild
            variant="outline"
            className="h-10 rounded-xl border-slate-200 bg-white text-slate-700"
          >
            <Link href="/admin/policies">
              <ArrowLeft className="size-4" />
              목록
            </Link>
          </Button>
        }
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <ShieldAlert className="mx-auto size-12 text-slate-300" />
          <h3 className="mt-4 text-base font-semibold text-slate-900">
            정책 정보를 찾을 수 없습니다
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            존재하지 않거나 삭제된 정책입니다. (ID: {id})
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button
              asChild
              className="rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
            >
              <Link href="/admin/policies">정책 목록 보기</Link>
            </Button>
          </div>
        </div>
      </DashboardPageShell>
    );
  }

  return <PolicyForm mode="edit" policy={policy} />;
}
