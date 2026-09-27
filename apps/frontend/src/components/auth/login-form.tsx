"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";

/**
 * 플랫폼 관리자 이메일 기본값 및 환경변수 설정
 */
const ADMIN_EMAIL =
  process.env.NEXT_PUBLIC_ADMIN_EMAIL || "admin@kubeguard.local";

/**
 * 플랫폼 관리자 문의 링크 (URL 또는 mailto)
 */
const ADMIN_CONTACT_URL =
  process.env.NEXT_PUBLIC_ADMIN_CONTACT_URL || `mailto:${ADMIN_EMAIL}`;

/**
 * 비밀번호 재설정 기본 mailto 템플릿
 */
const DEFAULT_FORGOT_PASSWORD_MAILTO = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(
  "[Kyverno Governance Platform] 비밀번호 재설정 요청",
)}&body=${encodeURIComponent(
  "안녕하세요 플랫폼 관리자님,\n\n계정 비밀번호 재설정을 요청합니다.\n- 계정(이메일):\n- 소속/부서:\n- 요청 사유:\n\n감사합니다.",
)}`;

/**
 * 비밀번호 재설정 포털 또는 메일 링크
 */
const FORGOT_PASSWORD_URL =
  process.env.NEXT_PUBLIC_FORGOT_PASSWORD_URL ||
  DEFAULT_FORGOT_PASSWORD_URL_FALLBACK();

/**
 * 환경변수 미지정 시 관리자 문의 기반의 기본 비밀번호 재설정 링크를 생성합니다.
 */
function DEFAULT_FORGOT_PASSWORD_URL_FALLBACK(): string {
  // 관리자 문의 링크가 외부 URL(사내 포털/헬프데스크)인 경우 해당 URL을 우선 연동
  if (process.env.NEXT_PUBLIC_ADMIN_CONTACT_URL) {
    return process.env.NEXT_PUBLIC_ADMIN_CONTACT_URL;
  }
  return DEFAULT_FORGOT_PASSWORD_MAILTO;
}

/**
 * 외부 웹 링크인지 여부를 판별합니다.
 */
function isExternalHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * 사용자 역할 및 이전 이동 요청 URL(next)에 따른 진입 경로를 결정합니다.
 *
 * @param {string} role 사용자 권한 역할 (ADMIN, APPROVER, REQUESTER 등)
 * @param {string | null} nextParam 쿼리스트링 next 파라미터
 * @returns {string} 리다이렉트할 대상 라우트 경로
 */
function getRedirectPath(role: string, nextParam: string | null): string {
  if (nextParam?.startsWith("/") && !nextParam.startsWith("//")) {
    return nextParam;
  }
  if (role === "ADMIN") {
    return "/admin/dashboard";
  }
  if (role === "APPROVER") {
    return "/admin/exceptions";
  }
  return "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { error, login, clearError, initialize, status, user } = useAuthStore();

  useEffect(() => {
    setMounted(true);
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (status === "authenticated" && user) {
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(getRedirectPath(user.role, next));
    }
  }, [status, user, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      const authenticatedUser = await login(email, password);
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(getRedirectPath(authenticatedUser.role, next));
    } catch {
      // 스토어에서 로그인 에러 상태를 관리하므로 별도 핸들링 생략
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasActiveSession =
    typeof window !== "undefined" &&
    localStorage.getItem("kyverno_auth_active") === "1";

  if (
    mounted &&
    (status === "authenticated" || (status === "loading" && hasActiveSession))
  ) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <div className="size-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="mt-4 text-xs font-medium text-slate-600">
          로그인 세션 확인 중...
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label
          htmlFor="email"
          className="text-[13px] font-medium text-slate-700"
        >
          {"\uc774\uba54\uc77c"}
        </Label>
        <div className="relative">
          <Mail
            aria-hidden="true"
            className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
          />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            required
            className="h-12 rounded-xl border-slate-200 bg-white pr-4 pl-10 text-sm shadow-xs placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-blue-500/15"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="password"
            className="text-[13px] font-medium text-slate-700"
          >
            {"\ube44\ubc00\ubc88\ud638"}
          </Label>
          <a
            href={FORGOT_PASSWORD_URL}
            {...(isExternalHttpUrl(FORGOT_PASSWORD_URL)
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
          >
            {"\ube44\ubc00\ubc88\ud638\ub97c \uc78a\uc73c\uc168\ub098\uc694?"}
          </a>
        </div>
        <div className="relative">
          <LockKeyhole
            aria-hidden="true"
            className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
          />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder={
              "\ube44\ubc00\ubc88\ud638\ub97c \uc785\ub825\ud558\uc138\uc694"
            }
            required
            className="h-12 rounded-xl border-slate-200 bg-white pr-11 pl-10 text-sm shadow-xs placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:ring-blue-500/15"
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={
              showPassword
                ? "\ube44\ubc00\ubc88\ud638 \uc228\uae30\uae30"
                : "\ube44\ubc00\ubc88\ud638 \ubcf4\uae30"
            }
            aria-pressed={showPassword}
            className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500"
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2.5 text-[13px] text-slate-600">
        <input
          type="checkbox"
          name="remember"
          className="size-4 rounded border-slate-300 accent-blue-600"
        />
        {"\ub85c\uadf8\uc778 \uc0c1\ud0dc \uc720\uc9c0"}
      </label>

      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        className="h-12 w-full rounded-xl bg-[#0b2342] text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#12325b] hover:shadow-md"
      >
        {isSubmitting ? "\ub85c\uadf8\uc778 \uc911" : "\ub85c\uadf8\uc778"}
        <ArrowRight className="ml-1 size-4" />
      </Button>

      {error ? (
        <p className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] text-slate-400">
          {"\uc811\uc18d\uc5d0 \ubb38\uc81c\uac00 \uc788\ub098\uc694?"}
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <p className="text-center text-xs leading-5 text-slate-500">
        {
          "\uacc4\uc815 \ub610\ub294 \uad8c\ud55c \uad00\ub828 \ubb38\uc758\ub294 "
        }
        <a
          href={ADMIN_CONTACT_URL}
          {...(isExternalHttpUrl(ADMIN_CONTACT_URL)
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-blue-600"
        >
          {"\ud50c\ub7ab\ud3fc \uad00\ub9ac\uc790"}
        </a>
        {"\uc5d0\uac8c \uc5f0\ub77d\ud558\uc138\uc694."}
      </p>
    </form>
  );
}
