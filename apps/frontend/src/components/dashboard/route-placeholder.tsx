import { ArrowRight, Clock3 } from "lucide-react";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";

type RoutePlaceholderProps = {
  variant?: "user" | "admin";
  activeHref: string;
  title: string;
  description: string;
  nextStep: string;
};

export function RoutePlaceholder({
  variant = "user",
  activeHref,
  title,
  description,
  nextStep,
}: RoutePlaceholderProps) {
  return (
    <DashboardPageShell
      variant={variant}
      activeHref={activeHref}
      title={title}
      description={description}
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
              페이지 준비
            </Badge>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              {description}
            </p>
          </div>
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Clock3 className="size-5" />
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <ArrowRight className="size-4 text-slate-400" />
          <span>{nextStep}</span>
        </div>
      </section>
    </DashboardPageShell>
  );
}
