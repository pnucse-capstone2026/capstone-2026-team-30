"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { error, login, clearError } = useAuthStore();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      const user = await login(email, password);
      const next = new URLSearchParams(window.location.search).get("next");

      if (next?.startsWith("/") && !next.startsWith("//")) {
        router.replace(next);
        return;
      }

      if (user.role === "ADMIN" || user.role === "APPROVER") {
        router.replace(
          user.role === "ADMIN"
            ? "/admin/dashboard"
            : user.role === "APPROVER"
              ? "/admin/exceptions"
              : "/dashboard",
        );
        return;
      }

      router.replace("/dashboard");
    } catch {
      // The store already exposes the login error for the form.
    } finally {
      setIsSubmitting(false);
    }
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
            href="#"
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
          href="mailto:admin@kubeguard.local"
          className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-blue-600"
        >
          {"\ud50c\ub7ab\ud3fc \uad00\ub9ac\uc790"}
        </a>
        {"\uc5d0\uac8c \uc5f0\ub77d\ud558\uc138\uc694."}
      </p>
    </form>
  );
}
