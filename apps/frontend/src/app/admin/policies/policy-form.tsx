"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Code2,
  FileCheck2,
  Loader2,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardPageShell } from "@/components/dashboard/dashboard-page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";
import { useDataStore } from "@/lib/data-store";
import {
  createPolicy,
  type CreatePolicyInput,
  type KyvernoPolicy,
  type PolicyMode,
  type PolicyScope,
  type PolicyStatus,
  type PolicyType,
  policyModeLabel,
  policyStatusLabel,
  policyTypeLabel,
} from "@/lib/policies";

type PolicyFormMode = "create" | "edit";

type PolicyFormState = {
  name: string;
  description: string;
  type: PolicyType;
  scope: PolicyScope;
  mode: PolicyMode;
  status: PolicyStatus;
  clusterName: string;
  namespace: string;
  owner: string;
  ruleName: string;
  matchKinds: string;
  message: string;
};

const defaultForm: PolicyFormState = {
  name: "",
  description: "",
  type: "validate",
  scope: "ClusterPolicy",
  mode: "audit",
  status: "draft",
  clusterName: "default",
  namespace: "",
  owner: "플랫폼팀",
  ruleName: "",
  matchKinds: "Pod, Deployment",
  message: "",
};

export function PolicyForm({
  mode,
  policy,
}: {
  mode: PolicyFormMode;
  policy?: KyvernoPolicy;
}) {
  const router = useRouter();
  const clusters = useDataStore((state) => state.clusters);
  const fetchClusters = useDataStore((state) => state.fetchClusters);
  const fetchPolicies = useDataStore((state) => state.fetchPolicies);
  const initializeAuth = useAuthStore((state) => state.initialize);

  const [form, setForm] = useState<PolicyFormState>(() =>
    policy
      ? {
          name: policy.name,
          description: policy.description,
          type: policy.type,
          scope: policy.scope,
          mode: policy.mode,
          status: policy.status,
          clusterName: policy.clusterId ?? policy.clusterName,
          namespace: policy.namespace ?? "",
          owner: policy.owner ?? "플랫폼팀",
          ruleName: `${policy.type}-${policy.name}`,
          matchKinds: "Pod, Deployment",
          message: policy.description,
        }
      : defaultForm,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (policy) {
      setForm({
        name: policy.name,
        description: policy.description,
        type: policy.type,
        scope: policy.scope,
        mode: policy.mode,
        status: policy.status,
        clusterName: policy.clusterId ?? policy.clusterName,
        namespace: policy.namespace ?? "",
        owner: policy.owner ?? "플랫폼팀",
        ruleName: policy.rules?.[0] || `${policy.type}-${policy.name}`,
        matchKinds: "Pod, Deployment",
        message: policy.description,
      });
    }
  }, [policy]);

  useEffect(() => {
    void (async () => {
      try {
        await initializeAuth();
        const loadedClusters = await fetchClusters();
        if (
          loadedClusters &&
          loadedClusters.length > 0 &&
          !policy &&
          form.clusterName === "default"
        ) {
          setForm((prev) => ({ ...prev, clusterName: loadedClusters[0].id }));
        }
      } catch {
        // ignore
      }
    })();
  }, [fetchClusters, form.clusterName, initializeAuth, policy]);

  const validationMessages = useMemo(() => {
    const messages: string[] = [];
    if (!form.name.trim()) {
      messages.push("정책 이름을 입력해야 합니다.");
    }
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(form.name.trim())) {
      messages.push(
        "정책 이름은 소문자, 숫자, 하이픈(-)만 포함할 수 있습니다.",
      );
    }
    if (!form.ruleName.trim()) {
      messages.push("규칙 이름을 입력해야 합니다.");
    }
    if (form.scope === "Policy" && !form.namespace.trim()) {
      messages.push("Policy 범위에서는 Namespace가 필요합니다.");
    }
    if (!form.matchKinds.trim()) {
      messages.push("적용 리소스 종류를 하나 이상 입력해야 합니다.");
    }
    return messages;
  }, [form]);

  const yaml = useMemo(() => buildPolicyYaml(form), [form]);
  const title = mode === "create" ? "정책 등록" : "정책 수정";
  const description =
    mode === "create"
      ? "새 Kyverno 정책의 기본 정보와 규칙 초안을 작성합니다."
      : "기존 Kyverno 정책의 기본 정보와 규칙 초안을 수정합니다.";

  function updateForm<K extends keyof PolicyFormState>(
    key: K,
    value: PolicyFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrorMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationMessages.length > 0) {
      setErrorMessage(validationMessages[0]);
      toast.error(validationMessages[0]);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (mode === "create") {
        const input: CreatePolicyInput = {
          name: form.name.trim(),
          clusterId: form.clusterName.trim() || "default",
          scope: form.scope,
          namespace:
            form.scope === "Policy" ? form.namespace.trim() : undefined,
          type: form.type,
          mode: form.mode,
          description: form.description.trim(),
          ruleName: form.ruleName.trim(),
          matchKinds: form.matchKinds.trim(),
          message: form.message.trim(),
          rawYaml: yaml,
        };

        const created = await createPolicy(input);
        toast.success(
          `정책 '${created.name}'이(가) 성공적으로 생성되었습니다.`,
        );
        await fetchPolicies(true);
        router.push("/admin/policies");
      } else {
        toast.success("정책 수정 요청이 완료되었습니다.");
        router.push(
          policy
            ? `/admin/policies/${encodeURIComponent(policy.id)}`
            : "/admin/policies",
        );
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      const msg = err.message || "정책 생성 요청 중 오류가 발생했습니다.";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DashboardPageShell
      variant="admin"
      activeHref="/admin/policies"
      title={title}
      description={description}
      actions={
        <Button
          asChild
          variant="outline"
          className="hidden h-10 rounded-xl border-slate-200 bg-white text-slate-700 sm:inline-flex"
        >
          <Link
            href={
              policy
                ? `/admin/policies/${encodeURIComponent(policy.id)}`
                : "/admin/policies"
            }
          >
            <ArrowLeft className="size-4" />
            {policy ? "상세" : "목록"}
          </Link>
        </Button>
      }
    >
      <form
        onSubmit={handleSubmit}
        className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]"
      >
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <FileCheck2 className="size-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">기본 정보</h2>
                <p className="mt-1 text-xs text-slate-500">
                  정책 이름, 범위, 적용 모드와 운영 상태를 지정합니다.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="정책 이름" htmlFor="policy-name">
                <Input
                  id="policy-name"
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  placeholder="require-resource-limits"
                  className="h-11"
                />
              </Field>
              <Field label="담당 팀" htmlFor="policy-owner">
                <Input
                  id="policy-owner"
                  value={form.owner}
                  onChange={(event) => updateForm("owner", event.target.value)}
                  placeholder="플랫폼팀"
                  className="h-11"
                />
              </Field>
              <Field label="정책 유형" htmlFor="policy-type">
                <select
                  id="policy-type"
                  value={form.type}
                  onChange={(event) =>
                    updateForm("type", event.target.value as PolicyType)
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/15"
                >
                  {(["validate", "mutate", "generate"] as PolicyType[]).map(
                    (type) => (
                      <option key={type} value={type}>
                        {policyTypeLabel[type]} ({type})
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="정책 범위" htmlFor="policy-scope">
                <select
                  id="policy-scope"
                  value={form.scope}
                  onChange={(event) =>
                    updateForm("scope", event.target.value as PolicyScope)
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/15"
                >
                  {(["ClusterPolicy", "Policy"] as PolicyScope[]).map(
                    (scope) => (
                      <option key={scope} value={scope}>
                        {scope}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="적용 모드" htmlFor="policy-mode">
                <select
                  id="policy-mode"
                  value={form.mode}
                  onChange={(event) =>
                    updateForm("mode", event.target.value as PolicyMode)
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/15"
                >
                  {(["audit", "enforce"] as PolicyMode[]).map((modeOption) => (
                    <option key={modeOption} value={modeOption}>
                      {policyModeLabel[modeOption]} ({modeOption})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="운영 상태" htmlFor="policy-status">
                <select
                  id="policy-status"
                  value={form.status}
                  onChange={(event) =>
                    updateForm("status", event.target.value as PolicyStatus)
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/15"
                >
                  {(["draft", "active", "warning"] as PolicyStatus[]).map(
                    (status) => (
                      <option key={status} value={status}>
                        {policyStatusLabel[status]} ({status})
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="클러스터" htmlFor="policy-cluster">
                {clusters && clusters.length > 0 ? (
                  <select
                    id="policy-cluster"
                    value={form.clusterName}
                    onChange={(event) =>
                      updateForm("clusterName", event.target.value)
                    }
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/15"
                  >
                    {clusters.map((cluster) => (
                      <option key={cluster.id} value={cluster.id}>
                        {cluster.displayName || cluster.id} ({cluster.id})
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="policy-cluster"
                    value={form.clusterName}
                    onChange={(event) =>
                      updateForm("clusterName", event.target.value)
                    }
                    placeholder="production"
                    className="h-11"
                  />
                )}
              </Field>
              <Field label="Namespace" htmlFor="policy-namespace">
                <Input
                  id="policy-namespace"
                  value={form.namespace}
                  onChange={(event) =>
                    updateForm("namespace", event.target.value)
                  }
                  placeholder="Policy 범위에서만 필요"
                  className="h-11"
                  disabled={form.scope === "ClusterPolicy"}
                />
              </Field>
            </div>

            <Field
              label="정책 설명"
              htmlFor="policy-description"
              className="mt-4"
            >
              <textarea
                id="policy-description"
                value={form.description}
                onChange={(event) =>
                  updateForm("description", event.target.value)
                }
                rows={3}
                placeholder="정책 목적과 운영 기준을 입력하세요."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/15"
              />
            </Field>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="size-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">규칙 초안</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Kyverno 엔진에 적용될 리소스 패턴과 메시지를 구성합니다.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="규칙 이름" htmlFor="policy-rule-name">
                <Input
                  id="policy-rule-name"
                  value={form.ruleName}
                  onChange={(event) =>
                    updateForm("ruleName", event.target.value)
                  }
                  placeholder="validate-resource-limits"
                  className="h-11"
                />
              </Field>
              <Field label="적용 리소스 종류" htmlFor="policy-match-kinds">
                <Input
                  id="policy-match-kinds"
                  value={form.matchKinds}
                  onChange={(event) =>
                    updateForm("matchKinds", event.target.value)
                  }
                  placeholder="Pod, Deployment"
                  className="h-11"
                />
              </Field>
            </div>

            <Field
              label="위반 메시지"
              htmlFor="policy-message"
              className="mt-4"
            >
              <textarea
                id="policy-message"
                value={form.message}
                onChange={(event) => updateForm("message", event.target.value)}
                rows={3}
                placeholder="정책 위반 시 사용자에게 보여줄 메시지를 입력하세요."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus-visible:border-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/15"
              />
            </Field>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h2 className="text-sm font-semibold">정책 배포 및 저장</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              작성한 정책 매니페스트를 대상 클러스터의 Kyverno에 즉시
              배포합니다.
            </p>

            <div className="mt-5 space-y-3">
              {validationMessages.length > 0 ? (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                  <div className="mb-2 flex items-center gap-2 font-semibold">
                    <AlertTriangle className="size-4" />
                    확인 필요
                  </div>
                  <ul className="space-y-1">
                    {validationMessages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="size-4" />
                    배포 가능한 유효한 정책 설정입니다.
                  </div>
                </div>
              )}

              {errorMessage ? (
                <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-800">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="size-3.5" />
                    오류 발생
                  </div>
                  {errorMessage}
                </div>
              ) : null}
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || validationMessages.length > 0}
              className="mt-5 h-11 w-full gap-2 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {mode === "create" ? "정책 생성 중..." : "정책 저장 중..."}
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  {mode === "create" ? "정책 등록 실행" : "정책 수정 저장"}
                </>
              )}
            </Button>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
              <div className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <Code2 className="size-4.5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">YAML 미리보기</h2>
                <p className="mt-1 text-xs text-slate-400">
                  클러스터에 배포될 Kyverno CRD 매니페스트
                </p>
              </div>
            </div>
            <pre className="max-h-[620px] overflow-auto p-5 text-xs leading-6 text-slate-700">
              <code>{yaml}</code>
            </pre>
          </section>
        </aside>
      </form>
    </DashboardPageShell>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-2 text-xs text-slate-600">
        {label}
      </Label>
      {children}
    </div>
  );
}

function buildPolicyYaml(form: PolicyFormState) {
  const kinds = form.matchKinds
    .split(",")
    .map((kind) => kind.trim())
    .filter(Boolean);
  const namespace =
    form.scope === "Policy" && form.namespace.trim()
      ? `  namespace: ${form.namespace.trim()}\n`
      : "";
  const renderedKinds =
    kinds.length > 0
      ? kinds.map((kind) => `                - ${kind}`).join("\n")
      : "                - Pod";

  return `apiVersion: kyverno.io/v1
kind: ${form.scope}
metadata:
  name: ${form.name || "new-policy"}
${namespace}spec:
  validationFailureAction: ${form.mode === "enforce" ? "Enforce" : "Audit"}
  background: true
  rules:
    - name: ${form.ruleName || "new-rule"}
      match:
        any:
          - resources:
              kinds:
${renderedKinds}
      ${form.type}:
        message: "${form.message || form.description || "정책 조건을 만족해야 합니다."}"
        pattern:
          metadata:
            labels:
              app: "?*"`;
}
