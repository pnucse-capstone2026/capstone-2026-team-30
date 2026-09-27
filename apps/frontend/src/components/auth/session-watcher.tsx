"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { API_BASE_URL } from "@/lib/auth-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * 실시간 중복 로그인 감지 및 강제 로그아웃(Kick-out) 모달 알림 컴포넌트입니다.
 * 백엔드 /api/auth/session-events SSE 채널을 구독하여 다른 환경에서 새 로그인이 발생하면
 * 즉시 화면에 모달을 띄우고 세션을 만료시킵니다.
 */
export function SessionWatcher() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const logout = useAuthStore((state) => state.logout);

  const [forceLogoutModalOpen, setForceLogoutModalOpen] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState(
    "다른 기기 또는 브라우저에서 새롭게 로그인되어 현재 접속이 종료되었습니다.",
  );

  useEffect(() => {
    if (!user || !accessToken) return;

    let eventSource: EventSource | null = null;
    let isCancelled = false;

    try {
      const sseUrl = `${API_BASE_URL}/auth/session-events?token=${encodeURIComponent(accessToken)}`;
      eventSource = new EventSource(sseUrl, { withCredentials: true });

      eventSource.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const data = JSON.parse(event.data);
          if (data?.type === "FORCE_LOGOUT") {
            setLogoutMessage(
              data.message ||
                "다른 기기 또는 브라우저에서 새롭게 로그인되어 현재 접속이 종료되었습니다.",
            );
            setForceLogoutModalOpen(true);
            void logout();
          }
        } catch {
          // ignore parsing error
        }
      };

      eventSource.onerror = () => {
        // SSE 에러 발생 시 자동 재연결
      };
    } catch {
      // ignore
    }

    return () => {
      isCancelled = true;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [user, accessToken, logout]);

  const handleConfirm = () => {
    setForceLogoutModalOpen(false);
    router.push("/");
  };

  return (
    <Dialog open={forceLogoutModalOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md rounded-2xl border-rose-100 bg-white p-6 shadow-2xl">
        <DialogHeader className="flex flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 mb-3 border border-rose-100">
            <ShieldAlert className="size-7" />
          </div>
          <DialogTitle className="text-lg font-bold text-slate-900">
            동시 접속으로 인한 세션 종료
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 mt-2 leading-relaxed max-w-sm">
            {logoutMessage}
            <br />
            계정 보안을 위해 동일 계정의 동시 접속은 제한됩니다.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4 sm:justify-center">
          <Button
            onClick={handleConfirm}
            className="h-10 w-full sm:w-auto px-6 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] text-xs font-semibold gap-2 cursor-pointer"
          >
            <LogOut className="size-4" />
            <span>로그인 화면으로 이동</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
