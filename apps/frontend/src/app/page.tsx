import { Activity, CheckCircle2, FileCheck2, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";

const platformStats = [
  {
    label: "\uc815\ucc45 \uc704\ubc18 \ud0d0\uc9c0",
    value: "\uc2e4\uc2dc\uac04",
    icon: FileCheck2,
  },
  {
    label: "\uba40\ud2f0 \ud074\ub7ec\uc2a4\ud130",
    value: "\ud1b5\ud569",
    icon: ShieldCheck,
  },
  {
    label: "\uc608\uc678 \uc2b9\uc778 \uc774\ub825",
    value: "\ucd94\uc801",
    icon: Activity,
  },
];

export default function Home() {
  return (
    <main className="min-h-dvh bg-[#f4f7fb] text-slate-950">
      <div className="mx-auto grid min-h-dvh max-w-[1600px] lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.92fr)]">
        <section className="relative hidden overflow-hidden bg-[#081b33] px-12 py-10 text-white lg:flex lg:flex-col xl:px-20 xl:py-14">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.16) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              maskImage:
                "linear-gradient(to bottom right, black, transparent 72%)",
            }}
          />
          <div className="pointer-events-none absolute -left-32 bottom-16 size-96 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-36 -top-28 size-[34rem] rounded-full bg-blue-500/15 blur-3xl" />

          <div className="relative flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 shadow-sm">
              <ShieldCheck className="size-5 text-cyan-300" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-[15px] font-semibold tracking-tight">
                Kyverno Governance
              </p>
              <p className="text-[11px] text-slate-400">
                Kyverno Governance Platform
              </p>
            </div>
          </div>

          <div className="relative my-auto max-w-2xl py-14">
            <p className="mb-5 text-xs font-semibold tracking-[0.2em] text-cyan-300 uppercase">
              Policy as Code, made visible
            </p>
            <h1 className="max-w-xl text-4xl leading-[1.22] font-semibold tracking-[-0.035em] xl:text-[52px]">
              {"\uc815\ucc45\uc740 \ub354 \uba85\ud655\ud558\uac8c,"}
              <br />
              {
                "\ud074\ub7ec\uc2a4\ud130\ub294 \ub354 \uc548\uc804\ud558\uac8c."
              }
            </h1>
            <p className="mt-6 max-w-lg text-[15px] leading-7 text-slate-300">
              {
                "\uc5ec\ub7ec \ud074\ub7ec\uc2a4\ud130\uc758 Kyverno \uc815\ucc45\uacfc \uc704\ubc18 \uc0ac\ud56d\uc744 \ud55c\uacf3\uc5d0\uc11c \ud655\uc778\ud558\uace0,"
              }
              <br />
              {
                "\uc608\uc678 \uc2b9\uc778\ubd80\ud130 \uc870\uce58 \uc774\ub825\uae4c\uc9c0 \uccb4\uacc4\uc801\uc73c\ub85c \uad00\ub9ac\ud558\uc138\uc694."
              }
            </p>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {platformStats.map(({ label, value, icon: Icon }) => (
                <div
                  key={label}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm"
                >
                  <Icon className="mb-5 size-4 text-cyan-300" />
                  <p className="text-xl font-semibold tracking-tight">
                    {value}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative flex items-center gap-2 text-xs text-slate-400">
            <CheckCircle2 className="size-3.5 text-emerald-400" />
            {
              "\ud1b5\ud569 \uc815\ucc45 \uac70\ubc84\ub10c\uc2a4 \uc6cc\ud06c\uc2a4\ud398\uc774\uc2a4"
            }
          </div>
        </section>

        <section className="flex min-h-dvh flex-col bg-white px-6 sm:px-10 lg:px-16 xl:px-24">
          <div className="flex h-20 items-center lg:hidden">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-[#0b2342]">
                <ShieldCheck className="size-4.5 text-cyan-300" />
              </div>
              <span className="text-sm font-semibold tracking-tight">
                Kyverno Governance
              </span>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center py-12">
            <div className="w-full max-w-[420px]">
              <div className="mb-9">
                <p className="mb-3 text-sm font-medium text-blue-600">
                  {
                    "\ub2e4\uc2dc \uc624\uc2e0 \uac83\uc744 \ud658\uc601\ud569\ub2c8\ub2e4"
                  }
                </p>
                <h2 className="text-[32px] font-semibold tracking-[-0.035em] text-slate-950">
                  {"\uacc4\uc815 \ub85c\uadf8\uc778"}
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  {
                    "\uc5c5\ubb34\uc6a9 \uacc4\uc815\uc73c\ub85c \ud50c\ub7ab\ud3fc\uc5d0 \uc811\uc18d\ud558\uc138\uc694."
                  }
                </p>
              </div>

              <LoginForm />
            </div>
          </div>

          <footer className="flex min-h-20 items-center justify-between gap-4 border-t border-slate-100 text-[11px] text-slate-400">
            <span>{"\u00a9 2026 Kyverno Governance Platform"}</span>
            <span>{"\uc548\uc804\ud55c \uc5f0\uacb0"}</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
