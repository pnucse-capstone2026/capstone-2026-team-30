"use client";

import Link from "next/link";
import { FilePlus2, FileQuestion, ListFilter } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type PolicyViolation } from "@/lib/policy-violations";

type NoExceptionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  violation: PolicyViolation;
};

export function NoExceptionDialog({
  open,
  onOpenChange,
  violation,
}: NoExceptionDialogProps) {
  const newExceptionUrl = `/admin/exceptions/new?policy=${encodeURIComponent(
    violation.policyName,
  )}&rule=${encodeURIComponent(violation.ruleName)}&cluster=${encodeURIComponent(
    violation.clusterId || violation.clusterName,
  )}&resource=${encodeURIComponent(
    violation.resourceName,
  )}&kind=${encodeURIComponent(
    violation.resourceKind,
  )}&namespace=${encodeURIComponent(violation.namespace)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <FileQuestion className="size-6" />
          </div>
          <DialogTitle className="mt-3 text-center text-lg font-semibold">
            진행 중인 예외 신청 없음
          </DialogTitle>
          <DialogDescription className="mt-2 text-center text-xs leading-relaxed text-slate-500">
            해당 정책 위반 (
            <span className="font-semibold text-slate-700">
              {violation.policyName}
            </span>{" "}
            - {violation.resourceKind}/{violation.resourceName})에 대한 진행
            중인 예외 신청 내역이 없습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
          <div className="flex justify-between py-1">
            <span className="text-slate-400">클러스터</span>
            <span className="font-medium text-slate-800">
              {violation.clusterDisplayName || violation.clusterName}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">네임스페이스</span>
            <span className="font-medium text-slate-800">
              {violation.namespace}
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">규칙명</span>
            <span className="font-medium text-slate-800">
              {violation.ruleName}
            </span>
          </div>
        </div>

        <DialogFooter className="mt-6 flex-col gap-2 sm:flex-col">
          <Button
            asChild
            className="w-full h-10 gap-2 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b]"
            onClick={() => onOpenChange(false)}
          >
            <Link href={newExceptionUrl}>
              <FilePlus2 className="size-4" />
              신규 예외 신청 작성
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="w-full h-10 gap-2 rounded-xl border-slate-200 text-slate-700"
            onClick={() => onOpenChange(false)}
          >
            <Link href="/admin/exceptions">
              <ListFilter className="size-4" />
              예외 신청 검토 목록으로 이동
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
