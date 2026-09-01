export type PolicyTemplatePreset = {
  id: string;
  name: string;
  category:
    | "안정성 & 리소스"
    | "보안 & 컨테이너 격리"
    | "공급망 & 이미지 보안"
    | "거버넌스 & 레이블";
  description: string;
  scope: "ClusterPolicy" | "Policy";
  mode: "audit" | "enforce";
  type: "validate" | "mutate" | "generate";
  ruleName: string;
  matchKinds: string;
  message: string;
  yaml: string;
};

export const POLICY_TEMPLATES: PolicyTemplatePreset[] = [
  {
    id: "require-resource-limits",
    name: "CPU & Memory 리소스 제한 강제",
    category: "안정성 & 리소스",
    description:
      "컨테이너의 CPU 및 Memory requests/limits 설정을 필수화하여 클러스터 자원 고갈과 OOM 장애를 방지합니다.",
    scope: "ClusterPolicy",
    mode: "audit",
    type: "validate",
    ruleName: "validate-resource-limits",
    matchKinds: "Pod, Deployment, StatefulSet, DaemonSet",
    message:
      "CPU 및 Memory의 requests와 limits 설정이 누락되었습니다. 컨테이너 spec에 리소스 제한을 명시하세요.",
    yaml: `apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-resource-limits
  annotations:
    policies.kyverno.io/title: Require CPU and Memory Limits
    policies.kyverno.io/category: Best Practices
    policies.kyverno.io/severity: medium
    policies.kyverno.io/description: >-
      Containers must specify CPU and Memory requests and limits to ensure stability.
spec:
  validationFailureAction: Audit
  background: true
  rules:
    - name: validate-resource-limits
      match:
        any:
          - resources:
              kinds:
                - Pod
                - Deployment
                - StatefulSet
                - DaemonSet
      validate:
        message: "CPU and memory requests and limits are required."
        pattern:
          spec:
            template:
              spec:
                containers:
                  - resources:
                      requests:
                        memory: "?*"
                        cpu: "?*"
                      limits:
                        memory: "?*"
                        cpu: "?*"`,
  },
  {
    id: "disallow-latest-tag",
    name: "최신(:latest) 이미지 태그 사용 금지",
    category: "공급망 & 이미지 보안",
    description:
      "재현 불가능한 ':latest' 태그의 사용을 금지하고 명시적인 시맨틱 버전 태그 또는 해시 사용을 강제합니다.",
    scope: "ClusterPolicy",
    mode: "audit",
    type: "validate",
    ruleName: "disallow-latest-tag",
    matchKinds: "Pod, Deployment, StatefulSet, DaemonSet",
    message:
      "':latest' 이미지 태그 사용은 금지됩니다. 명시적인 버전 태그(예: v1.2.0)를 사용하세요.",
    yaml: `apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
  annotations:
    policies.kyverno.io/title: Disallow Latest Tag
    policies.kyverno.io/category: Best Practices & Supply Chain
    policies.kyverno.io/severity: medium
spec:
  validationFailureAction: Audit
  background: true
  rules:
    - name: validate-image-tag
      match:
        any:
          - resources:
              kinds:
                - Pod
                - Deployment
                - StatefulSet
                - DaemonSet
      validate:
        message: "Using ':latest' tag is prohibited. Specify a concrete release tag or digest."
        pattern:
          spec:
            template:
              spec:
                containers:
                  - image: "!*:latest"`,
  },
  {
    id: "require-read-only-rootfs",
    name: "Root 파일시스템 읽기 전용 강제",
    category: "보안 & 컨테이너 격리",
    description:
      "컨테이너의 루트 파일시스템을 읽기 전용(readOnlyRootFilesystem: true)으로 강제하여 악성코드 변조를 차단합니다.",
    scope: "ClusterPolicy",
    mode: "audit",
    type: "validate",
    ruleName: "validate-read-only-rootfs",
    matchKinds: "Pod, Deployment, StatefulSet, DaemonSet",
    message:
      "컨테이너 보안을 위해 securityContext.readOnlyRootFilesystem은 반드시 true여야 합니다.",
    yaml: `apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-read-only-rootfs
  annotations:
    policies.kyverno.io/title: Require Read-Only Root Filesystem
    policies.kyverno.io/category: Pod Security Standards (Restricted)
    policies.kyverno.io/severity: high
spec:
  validationFailureAction: Audit
  background: true
  rules:
    - name: validate-read-only-rootfs
      match:
        any:
          - resources:
              kinds:
                - Pod
                - Deployment
                - StatefulSet
                - DaemonSet
      validate:
        message: "Root filesystem must be read-only (readOnlyRootFilesystem: true)."
        pattern:
          spec:
            template:
              spec:
                containers:
                  - securityContext:
                      readOnlyRootFilesystem: true`,
  },
  {
    id: "disallow-privileged-containers",
    name: "Privileged(특권) 컨테이너 실행 금지",
    category: "보안 & 컨테이너 격리",
    description:
      "호스트 시스템의 전체 디바이스와 커널에 접근할 수 있는 privileged: true 컨테이너의 실행을 차단합니다.",
    scope: "ClusterPolicy",
    mode: "enforce",
    type: "validate",
    ruleName: "disallow-privileged-containers",
    matchKinds: "Pod, Deployment, StatefulSet, DaemonSet",
    message: "호스트 보안을 위해 Privileged 컨테이너 실행은 엄격히 금지됩니다.",
    yaml: `apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-privileged-containers
  annotations:
    policies.kyverno.io/title: Disallow Privileged Containers
    policies.kyverno.io/category: Pod Security Standards (Baseline)
    policies.kyverno.io/severity: critical
spec:
  validationFailureAction: Enforce
  background: true
  rules:
    - name: check-privileged-flag
      match:
        any:
          - resources:
              kinds:
                - Pod
                - Deployment
                - StatefulSet
                - DaemonSet
      validate:
        message: "Privileged containers are strictly prohibited."
        pattern:
          spec:
            template:
              spec:
                containers:
                  - securityContext:
                      =(privileged): false`,
  },
  {
    id: "restrict-image-registries",
    name: "사내 승인 이미지 레지스트리만 허용",
    category: "공급망 & 이미지 보안",
    description:
      "검증되지 않은 퍼블릭 레지스트리 이미지를 차단하고 사내 AWS ECR 또는 공인 ECR 이미지만 배포를 허용합니다.",
    scope: "ClusterPolicy",
    mode: "audit",
    type: "validate",
    ruleName: "validate-registries",
    matchKinds: "Pod, Deployment, StatefulSet, DaemonSet",
    message:
      "승인되지 않은 외부 이미지 레지스트리입니다. 사내 AWS ECR 또는 public.ecr.aws 이미지만 배포 가능합니다.",
    yaml: `apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: restrict-image-registries
  annotations:
    policies.kyverno.io/title: Restrict Container Image Registries
    policies.kyverno.io/category: Supply Chain Security
    policies.kyverno.io/severity: high
spec:
  validationFailureAction: Audit
  background: true
  rules:
    - name: validate-registries
      match:
        any:
          - resources:
              kinds:
                - Pod
                - Deployment
                - StatefulSet
                - DaemonSet
      validate:
        message: "Images must come from approved Amazon ECR registries."
        pattern:
          spec:
            template:
              spec:
                containers:
                  - image: "945125812546.dkr.ecr.us-east-1.amazonaws.com/* | public.ecr.aws/*"`,
  },
  {
    id: "require-standard-labels",
    name: "필수 운영 표준 레이블(app, owner) 강제",
    category: "거버넌스 & 레이블",
    description:
      "자원 추적 및 담당자 식별을 위해 모든 워크로드에 'app'과 'owner' 레이블 명시를 강제합니다.",
    scope: "ClusterPolicy",
    mode: "audit",
    type: "validate",
    ruleName: "require-labels",
    matchKinds: "Pod, Deployment, StatefulSet, Service",
    message:
      "운영 리소스에는 'app' 및 'owner' 메타데이터 레이블이 반드시 포함되어야 합니다.",
    yaml: `apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-standard-labels
  annotations:
    policies.kyverno.io/title: Require Standard Labels
    policies.kyverno.io/category: Governance
    policies.kyverno.io/severity: low
spec:
  validationFailureAction: Audit
  background: true
  rules:
    - name: require-labels
      match:
        any:
          - resources:
              kinds:
                - Pod
                - Deployment
                - StatefulSet
                - Service
      validate:
        message: "Resource metadata must have 'app' and 'owner' labels."
        pattern:
          metadata:
            labels:
              app: "?*"
              owner: "?*"`,
  },
];
