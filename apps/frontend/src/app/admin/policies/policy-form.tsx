"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import * as yamlParser from "js-yaml";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FileCheck2,
  FileText,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
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
import { POLICY_TEMPLATES, PolicyTemplatePreset } from "./policy-templates";

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
  mode: "enforce",
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

  const [activeTab, setActiveTab] = useState<"form" | "yaml">("form");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

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

  const [customYaml, setCustomYaml] = useState<string>("");
  const [isYamlManuallyEdited, setIsYamlManuallyEdited] =
    useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
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
      if (policy.rawJson) {
        try {
          const formatted = yamlParser.dump(policy.rawJson);
          setCustomYaml(formatted);
          setIsYamlManuallyEdited(true);
        } catch {
          // ignore
        }
      }
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

  // 폼 필드 변경 시 자동 생성되는 기본 YAML
  const generatedYaml = useMemo(() => buildPolicyYaml(form), [form]);

  // 최종 사용되는 YAML (수동 편집된 경우 customYaml 우선)
  const currentYaml = isYamlManuallyEdited ? customYaml : generatedYaml;

  // YAML 구문 유효성 실시간 검증
  const yamlValidationError = useMemo(() => {
    if (!currentYaml.trim()) return "YAML 내용이 비어있습니다.";
    try {
      const parsed = yamlParser.load(currentYaml) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") {
        return "유효한 YAML 오브젝트 형식이 아닙니다.";
      }
      if (!parsed.kind) {
        return "YAML에 'kind' (ClusterPolicy 또는 Policy) 필드가 누락되었습니다.";
      }
      return null;
    } catch (e) {
      return `YAML 구문 오류: ${(e as Error).message}`;
    }
  }, [currentYaml]);

  const validationMessages = useMemo(() => {
    const messages: string[] = [];

    if (isYamlManuallyEdited) {
      if (yamlValidationError) {
        messages.push(yamlValidationError);
      }
      return messages;
    }

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
  }, [form, isYamlManuallyEdited, yamlValidationError]);

  const title = mode === "create" ? "정책 등록" : "정책 수정";
  const description =
    mode === "create"
      ? "새 Kyverno 정책을 폼 작성 또는 직접 YAML 편집기를 통해 배포합니다."
      : "기존 Kyverno 정책의 기본 정보와 매니페스트 설정을 수정합니다.";

  function updateForm<K extends keyof PolicyFormState>(
    key: K,
    value: PolicyFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setIsYamlManuallyEdited(false);
    setErrorMessage(null);
  }

  // 템플릿 선택 핸들러
  function handleSelectTemplate(template: PolicyTemplatePreset) {
    setSelectedTemplateId(template.id);
    setForm((prev) => ({
      ...prev,
      name: template.id,
      description: template.description,
      type: template.type,
      scope: template.scope,
      mode: template.mode,
      ruleName: template.ruleName,
      matchKinds: template.matchKinds,
      message: template.message,
    }));
    setCustomYaml(template.yaml.trim());
    setIsYamlManuallyEdited(true);
    toast.info(`'${template.name}' 템플릿이 로드되었습니다.`);
  }

  // YAML 수동 편집 핸들러
  function handleYamlChange(val: string) {
    setCustomYaml(val);
    setIsYamlManuallyEdited(true);
    setErrorMessage(null);

    // 가능한 경우 폼 필드와 동기화 시도
    try {
      const parsed = yamlParser.load(val) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        const meta = parsed.metadata as Record<string, unknown> | undefined;
        const spec = parsed.spec as Record<string, unknown> | undefined;
        if (meta?.name && typeof meta.name === "string") {
          setForm((prev) => ({ ...prev, name: meta.name as string }));
        }
        if (parsed.kind === "ClusterPolicy" || parsed.kind === "Policy") {
          setForm((prev) => ({ ...prev, scope: parsed.kind as PolicyScope }));
        }
        if (spec?.validationFailureAction === "Enforce") {
          setForm((prev) => ({ ...prev, mode: "enforce" }));
        } else if (spec?.validationFailureAction === "Audit") {
          setForm((prev) => ({ ...prev, mode: "audit" }));
        }
      }
    } catch {
      // ignore parse errors while typing
    }
  }

  // 클립보드 복사
  async function handleCopyYaml() {
    try {
      await navigator.clipboard.writeText(currentYaml);
      setCopied(true);
      toast.success("YAML 매니페스트가 클립보드에 복사되었습니다.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("클립보드 복사에 실패했습니다.");
    }
  }

  // 폼 기반 YAML로 리셋
  function handleResetToFormYaml() {
    setIsYamlManuallyEdited(false);
    setSelectedTemplateId("");
    toast.info("폼 입력값 기반 YAML로 재설정되었습니다.");
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
          rawYaml: currentYaml,
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
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            className="h-9 rounded-xl border-slate-200 bg-white text-xs text-slate-700 sm:inline-flex"
          >
            <Link
              href={
                policy
                  ? `/admin/policies/${encodeURIComponent(policy.id)}`
                  : "/admin/policies"
              }
            >
              <ArrowLeft className="size-3.5 mr-1" />
              {policy ? "상세로 돌아가기" : "목록으로"}
            </Link>
          </Button>
        </div>
      }
    >
      {/* 🎯 추천 정책 템플릿 프리셋 픽커 바 */}
      {mode === "create" && (
        <div className="mb-6 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-blue-50/50 to-white p-4 shadow-xs">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <span className="text-xs font-semibold text-slate-800">
                표준 베스트 프랙티스 정책 템플릿 (원클릭 로드)
              </span>
            </div>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              템플릿을 선택하면 폼과 YAML이 즉시 완성되며 자유롭게
              커스터마이징할 수 있습니다.
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {POLICY_TEMPLATES.map((tmpl) => {
              const isSelected = selectedTemplateId === tmpl.id;
              return (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => handleSelectTemplate(tmpl)}
                  className={`flex flex-col text-left p-2.5 rounded-xl border text-xs transition-all ${
                    isSelected
                      ? "border-indigo-500 bg-white shadow-xs ring-2 ring-indigo-500/20 text-indigo-900"
                      : "border-slate-200/80 bg-white/80 hover:bg-white hover:border-indigo-300 text-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-[11px] truncate">
                      {tmpl.name}
                    </span>
                    {isSelected && (
                      <Check className="h-3 w-3 text-indigo-600 shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono truncate">
                    {tmpl.id}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 작성 모드 탭 전환기 */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("form")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === "form"
                ? "bg-[#0b2342] text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>폼 기반 작성 모드</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("yaml")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === "yaml"
                ? "bg-[#0b2342] text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>직접 YAML 에디터 모드</span>
            {isYamlManuallyEdited && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-900 text-[9px] font-bold">
                수정됨
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {isYamlManuallyEdited && (
            <button
              type="button"
              onClick={handleResetToFormYaml}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 bg-white border border-slate-200 px-2.5 py-1 rounded-lg transition"
              title="폼 입력값 기반 기본 YAML로 리셋"
            >
              <RotateCcw className="h-3 w-3" />
              <span>기본 폼 동기화</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyYaml}
            className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900 bg-white border border-slate-200 px-2.5 py-1 rounded-lg transition"
            title="YAML 매니페스트 복사"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-600" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            <span>{copied ? "복사됨" : "YAML 복사"}</span>
          </button>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]"
      >
        {/* 좌측: 폼 모드 vs YAML 에디터 모드 */}
        <div className="space-y-6">
          {activeTab === "form" ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <FileCheck2 className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">
                      1. 기본 정보 및 정책 스코프
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      정책 이름, 범위(Cluster/Namespace), 적용 모드와 대상
                      클러스터를 지정합니다.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <Field
                    label="정책 이름 (Kubernetes DNS 규격)"
                    htmlFor="policy-name"
                    required
                  >
                    <Input
                      id="policy-name"
                      value={form.name}
                      onChange={(event) =>
                        updateForm("name", event.target.value)
                      }
                      placeholder="require-resource-limits"
                      className="h-10 text-xs font-mono"
                    />
                  </Field>
                  <Field
                    label="담당 팀 / 소유자"
                    htmlFor="policy-owner"
                    optional
                  >
                    <Input
                      id="policy-owner"
                      value={form.owner}
                      onChange={(event) =>
                        updateForm("owner", event.target.value)
                      }
                      placeholder="플랫폼팀"
                      className="h-10 text-xs"
                    />
                  </Field>
                  <Field
                    label="정책 유형 (Kyverno Action)"
                    htmlFor="policy-type"
                    required
                  >
                    <select
                      id="policy-type"
                      value={form.type}
                      onChange={(event) =>
                        updateForm("type", event.target.value as PolicyType)
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus-visible:border-blue-500"
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
                  <Field
                    label="정책 범위 (Scope)"
                    htmlFor="policy-scope"
                    required
                  >
                    <select
                      id="policy-scope"
                      value={form.scope}
                      onChange={(event) =>
                        updateForm("scope", event.target.value as PolicyScope)
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus-visible:border-blue-500"
                    >
                      {(["ClusterPolicy", "Policy"] as PolicyScope[]).map(
                        (scope) => (
                          <option key={scope} value={scope}>
                            {scope === "ClusterPolicy"
                              ? "ClusterPolicy (클러스터 전체 적용)"
                              : "Policy (특정 Namespace 전용)"}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field
                    label="동작 모드 (Failure Action)"
                    htmlFor="policy-mode"
                    required
                  >
                    <select
                      id="policy-mode"
                      value={form.mode}
                      onChange={(event) =>
                        updateForm("mode", event.target.value as PolicyMode)
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus-visible:border-blue-500"
                    >
                      {(["audit", "enforce"] as PolicyMode[]).map(
                        (modeOption) => (
                          <option key={modeOption} value={modeOption}>
                            {policyModeLabel[modeOption]} ({modeOption}) -{" "}
                            {modeOption === "audit"
                              ? "감사 및 위반 보고서만 생성"
                              : "위반 시 배포 즉시 차단"}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                  <Field label="운영 상태" htmlFor="policy-status" required>
                    <select
                      id="policy-status"
                      value={form.status}
                      onChange={(event) =>
                        updateForm("status", event.target.value as PolicyStatus)
                      }
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus-visible:border-blue-500"
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
                  <Field
                    label="대상 클러스터"
                    htmlFor="policy-cluster"
                    required
                  >
                    {clusters && clusters.length > 0 ? (
                      <select
                        id="policy-cluster"
                        value={form.clusterName}
                        onChange={(event) =>
                          updateForm("clusterName", event.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus-visible:border-blue-500"
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
                        placeholder="default"
                        className="h-10 text-xs"
                      />
                    )}
                  </Field>
                  <Field
                    label="적용 네임스페이스"
                    htmlFor="policy-namespace"
                    required={form.scope === "Policy"}
                    optional={form.scope === "ClusterPolicy"}
                  >
                    <Input
                      id="policy-namespace"
                      value={form.namespace}
                      onChange={(event) =>
                        updateForm("namespace", event.target.value)
                      }
                      placeholder={
                        form.scope === "ClusterPolicy"
                          ? "클러스터 전체 적용 (선택 불가)"
                          : "default"
                      }
                      className="h-10 text-xs"
                      disabled={form.scope === "ClusterPolicy"}
                    />
                  </Field>
                </div>

                <Field
                  label="정책 도입 배경 및 목적 설명"
                  htmlFor="policy-description"
                  className="mt-4"
                  optional
                >
                  <textarea
                    id="policy-description"
                    value={form.description}
                    onChange={(event) =>
                      updateForm("description", event.target.value)
                    }
                    rows={2}
                    placeholder="이 정책을 도입하는 보안 배경 및 기대 효과를 입력하세요."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus-visible:border-blue-500"
                  />
                </Field>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Shield className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">
                      2. Kyverno 규칙 및 리소스 필터
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      정책 엔진이 감사할 리소스 패턴과 사용자 경고 메시지를
                      정의합니다.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <Field
                    label="규칙(Rule) 식별명"
                    htmlFor="policy-rule-name"
                    required
                  >
                    <Input
                      id="policy-rule-name"
                      value={form.ruleName}
                      onChange={(event) =>
                        updateForm("ruleName", event.target.value)
                      }
                      placeholder="validate-resource-limits"
                      className="h-10 text-xs font-mono"
                    />
                  </Field>
                  <Field
                    label="적용 대상 리소스 종류 (쉼표 구분)"
                    htmlFor="policy-match-kinds"
                    required
                  >
                    <Input
                      id="policy-match-kinds"
                      value={form.matchKinds}
                      onChange={(event) =>
                        updateForm("matchKinds", event.target.value)
                      }
                      placeholder="Pod, Deployment, StatefulSet, DaemonSet"
                      className="h-10 text-xs font-mono"
                    />
                  </Field>
                </div>

                <Field
                  label="위반 시 사용자 노출 안내 메시지"
                  htmlFor="policy-message"
                  className="mt-4"
                  optional
                >
                  <textarea
                    id="policy-message"
                    value={form.message}
                    onChange={(event) =>
                      updateForm("message", event.target.value)
                    }
                    rows={2}
                    placeholder="정책 위반 시 개발자/운영자에게 노출될 가이드 메시지를 입력하세요."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus-visible:border-blue-500"
                  />
                </Field>
              </section>
            </>
          ) : (
            /* 💻 직접 YAML 에디터 모드 */
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col h-[680px]">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Code2 className="size-5 text-indigo-600" />
                  <div>
                    <h2 className="text-sm font-semibold">
                      Kyverno 매니페스트 직접 편집 (Direct YAML Editor)
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Kyverno의 pattern, anyPattern, deny conditions, mutate,
                      generate 문법을 자유롭게 작성할 수 있습니다.
                    </p>
                  </div>
                </div>

                {yamlValidationError ? (
                  <span className="text-[11px] text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded font-medium">
                    YAML 구문 에러 감지
                  </span>
                ) : (
                  <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                    유효한 YAML 구문
                  </span>
                )}
              </div>

              <div className="relative flex-1 rounded-xl border border-slate-300 bg-slate-950 p-1 shadow-inner overflow-hidden flex flex-col">
                <textarea
                  value={currentYaml}
                  onChange={(e) => handleYamlChange(e.target.value)}
                  spellCheck={false}
                  className="w-full flex-1 bg-transparent p-4 font-mono text-xs text-emerald-400 leading-relaxed outline-none resize-none selection:bg-indigo-700 selection:text-white"
                  placeholder="apiVersion: kyverno.io/v1..."
                />
              </div>
            </section>
          )}
        </div>

        {/* 우측 사이드바: 배포 컨트롤 및 실시간 YAML 프리뷰 */}
        <aside className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <h2 className="text-sm font-semibold">정책 배포 및 저장</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              작성한 정책 매니페스트를 대상 클러스터의 Kyverno에 즉시
              배포합니다.
            </p>

            <div className="mt-4 space-y-2.5">
              {validationMessages.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-800">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="size-3.5" />
                    확인 필요
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    {validationMessages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs leading-5 text-emerald-800">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="size-4" />
                    배포 가능한 유효한 정책 설정입니다.
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-5 text-rose-800">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="size-3.5" />
                    오류 발생
                  </div>
                  {errorMessage}
                </div>
              )}
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || validationMessages.length > 0}
              className="mt-5 h-11 w-full gap-2 rounded-xl bg-[#0b2342] text-white hover:bg-[#12325b] disabled:opacity-50 text-xs font-semibold shadow-sm cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {mode === "create" ? "정책 배포 중..." : "정책 저장 중..."}
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  {mode === "create"
                    ? "Kyverno 정책 클러스터 배포"
                    : "정책 수정 저장"}
                </>
              )}
            </Button>
          </section>

          {/* 우측 실시간 YAML 뷰어 (폼 모드일 때만 표시) */}
          {activeTab === "form" && (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Code2 className="size-4 text-slate-600" />
                  <span className="text-xs font-semibold">
                    실시간 매니페스트 프리뷰
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("yaml")}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  에디터로 전환 ➔
                </button>
              </div>
              <pre className="max-h-[480px] overflow-auto p-4 font-mono text-[11px] leading-5 text-slate-800 bg-slate-900 text-emerald-400 select-all">
                <code>{currentYaml}</code>
              </pre>
            </section>
          )}
        </aside>
      </form>
    </DashboardPageShell>
  );
}

function Field({
  label,
  htmlFor,
  className,
  required,
  optional,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-700"
      >
        <span>{label}</span>
        {required && (
          <>
            <span className="text-rose-500 font-bold">*</span>
            <span className="text-[10px] text-rose-500 font-normal">
              (필수)
            </span>
          </>
        )}
        {optional && (
          <span className="text-[10px] text-slate-400 font-normal">(선택)</span>
        )}
      </Label>
      {children}
      {error && (
        <p className="mt-1 text-[11px] font-medium text-rose-600">* {error}</p>
      )}
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
${namespace}  annotations:
    policies.kyverno.io/description: "${form.description || "Kyverno policy"}"
spec:
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
