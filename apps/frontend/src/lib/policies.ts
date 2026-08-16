export type PolicyType = "validate" | "mutate" | "generate";
export type PolicyScope = "ClusterPolicy" | "Policy";
export type PolicyMode = "enforce" | "audit";
export type PolicyStatus = "active" | "warning" | "draft";

export type KyvernoPolicy = {
  id: string;
  name: string;
  type: PolicyType;
  scope: PolicyScope;
  mode: PolicyMode;
  status: PolicyStatus;
  clusterName: string;
  namespace: string | null;
  ruleCount: number;
  violationCount: number;
  owner: string;
  updatedAt: string;
  description: string;
};

export const kyvernoPolicies: KyvernoPolicy[] = [
  {
    id: "require-resource-limits",
    name: "require-resource-limits",
    type: "validate",
    scope: "ClusterPolicy",
    mode: "enforce",
    status: "warning",
    clusterName: "production",
    namespace: null,
    ruleCount: 2,
    violationCount: 4,
    owner: "플랫폼팀",
    updatedAt: "2026-07-08 10:42",
    description: "운영 워크로드에 CPU와 memory requests/limits 설정을 강제합니다.",
  },
  {
    id: "disallow-latest-tag",
    name: "disallow-latest-tag",
    type: "validate",
    scope: "ClusterPolicy",
    mode: "enforce",
    status: "warning",
    clusterName: "staging",
    namespace: null,
    ruleCount: 1,
    violationCount: 2,
    owner: "배치서비스팀",
    updatedAt: "2026-07-08 10:17",
    description: "재현 가능한 배포를 위해 latest 이미지 태그 사용을 제한합니다.",
  },
  {
    id: "require-team-label",
    name: "require-team-label",
    type: "validate",
    scope: "Policy",
    mode: "audit",
    status: "active",
    clusterName: "development",
    namespace: "users",
    ruleCount: 1,
    violationCount: 1,
    owner: "사용자서비스팀",
    updatedAt: "2026-07-08 09:53",
    description: "리소스 소유 추적을 위해 team 라벨을 요구합니다.",
  },
  {
    id: "restrict-host-path",
    name: "restrict-host-path",
    type: "validate",
    scope: "ClusterPolicy",
    mode: "enforce",
    status: "active",
    clusterName: "production",
    namespace: null,
    ruleCount: 2,
    violationCount: 1,
    owner: "SRE팀",
    updatedAt: "2026-07-08 09:21",
    description: "승인되지 않은 hostPath 볼륨 사용을 제한합니다.",
  },
  {
    id: "require-image-registry",
    name: "require-image-registry",
    type: "mutate",
    scope: "Policy",
    mode: "audit",
    status: "active",
    clusterName: "sandbox",
    namespace: "default",
    ruleCount: 1,
    violationCount: 0,
    owner: "교육지원팀",
    updatedAt: "2026-07-08 08:48",
    description: "허용된 이미지 레지스트리 접두어를 기본값으로 보정합니다.",
  },
  {
    id: "generate-network-policy",
    name: "generate-network-policy",
    type: "generate",
    scope: "ClusterPolicy",
    mode: "audit",
    status: "draft",
    clusterName: "development",
    namespace: null,
    ruleCount: 1,
    violationCount: 0,
    owner: "플랫폼팀",
    updatedAt: "2026-07-07 16:20",
    description: "신규 네임스페이스에 기본 NetworkPolicy 생성을 준비합니다.",
  },
];

export const policyTypeLabel: Record<PolicyType, string> = {
  validate: "검증",
  mutate: "변경",
  generate: "생성",
};

export const policyModeLabel: Record<PolicyMode, string> = {
  enforce: "강제",
  audit: "감사",
};

export const policyStatusLabel: Record<PolicyStatus, string> = {
  active: "정상",
  warning: "주의",
  draft: "초안",
};

export const policyStatusClassName: Record<PolicyStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  draft: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

export const policyTypeClassName: Record<PolicyType, string> = {
  validate: "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  mutate: "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
  generate: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100",
};
