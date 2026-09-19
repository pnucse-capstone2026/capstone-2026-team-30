# Multi-Cluster Governance Remediation & Enhancement Plan
# (멀티클러스터 거버넌스 플랫폼 순차적 개선 계획서)

본 문서는 PaC Kyverno Governance Platform의 멀티클러스터(Hub-Spoke) 환경 전수조사에서 식별된 **6대 핵심 결함(CRITICAL 2건, HIGH 3건, MEDIUM 1건)**을 해결하기 위해 작성된 독립적인 개선 계획서입니다. 다른 작업 에이전트나 엔지니어가 본 문서를 기준으로 작업을 원활히 인계받아 순차적으로 개선을 수행할 수 있도록 표준화된 실행 절차와 코드리뷰 품질 게이트를 규정합니다.

---

## 1. 전수조사 식별 결함 요약 매트릭스

| 번호 | 영역 | 식별된 결함 및 리스크 | 심각도 | 영향 받는 컴포넌트 |
| :--- | :--- | :--- | :---: | :--- |
| **#1** | **정책 격리** | `isolate-management-hub-cluster.yaml`이 정책 루트에 위치하여 Argo CD가 Spoke로 동기화 시 전체 프로덕션 워크로드 차단 | **CRITICAL** | `k8s-manifests/policies`, Argo CD `01-spoke-governance-policies` |
| **#2** | **리더 선출 / 실시간 감시** | Hub RBAC의 `leases`, `events` 권한 누락으로 리더 선출 403 거부 ➡️ Informer, Incident Watcher, Drift Detector 영구 정지 | **CRITICAL** | `k8s-manifests/system/rbac.yaml`, `K8sLeaderElectorService`, `AdmissionIncidentWatcherService`, `K8sInformerService` |
| **#3** | **클러스터 관제** | Spoke `kyverno-remote-agent-role`에 `nodes` 권한 누락으로 `ClusterOverviewService` 호출 시 403 거부 및 노드 지표 결측 | **HIGH** | `k8s-manifests/rbac/spoke-remote-agent-rbac.yaml`, `ClusterOverviewService` |
| **#4** | **정책 생명주기** | 정책(ClusterPolicy/Policy) 수정(PUT) 및 삭제(DELETE) API 전무, 런타임 직접 생성 시 Argo CD Self-Healing에 의한 자동 Prune | **HIGH** | `PoliciesService`, `PoliciesController`, `KyvernoAdapter`, `GitOpsPublisherService` |
| **#5** | **드리프트 감지** | `PolicyDriftDetectorService`가 `policyexceptions`만 필터링하여 `ClusterPolicy`/`Policy` 드리프트 감지 전면 누락 | **HIGH** | `PolicyDriftDetectorService`, `K8sInformerService` |
| **#6** | **위반 리포트** | PolicyReport의 `results` 배열 인덱스 기반 ID 생성으로 순서 변경 시 ID Flapping 및 DB 위반 상태 매핑 왜곡 | **MEDIUM** | `KyvernoAdapter.listNamespacedPolicyReports`, `ViolationsService` |

---

## 2. 브랜치 관리 및 릴리즈 전략 (Branching Strategy)

다른 에이전트 및 작업자가 안정적으로 분업하고 충돌을 방지하기 위해 GitFlow 기반의 단계별 기능 브랜치 전략을 준수합니다.

```text
main (v1.0.0 Stable)
 └── release/v1.1.0-remediation (통합 릴리즈 브랜치)
      ├── fix/phase1-isolation-and-rbac      [Phase 1] Hub 격리 경로 분리 및 Hub Lease/Events RBAC
      ├── fix/phase2-cluster-overview        [Phase 2] Spoke nodes RBAC 및 개요 지표 정상화
      ├── feat/phase3-policy-crud-gitops     [Phase 3] 정책 update/delete API 및 GitOps 파이프라인
      ├── feat/phase4-drift-detector         [Phase 4] ClusterPolicy 드리프트 감지 엔진 확장
      └── fix/phase5-deterministic-violation-id [Phase 5] 불변 해시 기반 위반 식별자 체계 구축
```

1. **통합 기준 브랜치**: `release/v1.1.0-remediation`
   - 모든 Phase 작업 브랜치는 본 브랜치에서 체크아웃하여 작업을 시작합니다.
2. **Phase별 단위 작업 브랜치**:
   - `fix/phase1-isolation-and-rbac` (결함 #1, #2)
   - `fix/phase2-cluster-overview` (결함 #3)
   - `feat/phase3-policy-crud-gitops` (결함 #4)
   - `feat/phase4-drift-detector` (결함 #5)
   - `fix/phase5-deterministic-violation-id` (결함 #6)
3. **머지 승인 절차**:
   - 각 Phase 브랜치는 아래 제3절의 **'품질 게이트 및 코드리뷰 체크리스트'를 100% 만족**해야만 통합 브랜치로 머지할 수 있습니다.

---

## 3. 코드리뷰 품질 게이트 (Quality Gate Checklist)

> [!IMPORTANT]
> **모든 작업 에이전트는 아래 4대 핵심 관점(정합성, 유지보수성, 보안, 일관성)의 코드리뷰 항목을 완벽히 검증하고 통과하기 전에는 절대로 커밋 메시지 작성 및 커밋 완료를 선언해서는 안 됩니다.**

### 3.1. 정합성 (Correctness & Consistency)
* [ ] **런타임-GitOps 경로 일치**: K8s 배포 네임스페이스와 GitOps 매니페스트 저장 경로(Argo CD Application `source.path`)가 1:1로 정확히 수렴하는가?
* [ ] **멀티클러스터 식별자 불변성**: K8s Client 및 DB 레코드 상의 `clusterId`가 일관되게 전달되는가? (`kyverno-eks-lab` vs `external-argocd-cluster`)
* [ ] **데이터 플래핑(Flapping) 방지**: 리스트 인덱스나 동적 생성 값이 아닌, 고유하고 불변인 식별자(Deterministic Hash)를 Key로 사용하는가?
* [ ] **상태 머신 무결성**: 분산 환경에서 리더십을 상실하거나 네트워크가 단절되었을 때 Watcher/Informer가 안전하게 중지(Graceful Stop)되는가?

### 3.2. 유지보수성 (Maintainability & Clean Architecture)
* [ ] **계층 구조 준수**: Controller ➡️ Service ➡️ Adapter / Provider ➡️ DB/K8s 계층 간 단방향 의존성을 유지하고 순환 참조가 없는가?
* [ ] **JSDoc 작성 표준**: 모든 신규 클래스, 인터페이스, 메서드에 JSDoc(`/** ... */`) 표준 설명, `@param`, `@returns`, `@throws`가 명확히 기술되었는가?
* [ ] **클러스터 설정 단일화**: K8s 접속 설정 조회가 `ClusterProvider`로 단일화되어 중복 코드(`loadFromDefault()`)가 제거되었는가?
* [ ] **죽은 코드/스텁 방지**: 미구현 상태의 감지기(`FluxCdIncidentDetector` 등)나 빈 catch 블록이 방치되지 않고 명시적으로 처리되었는가?

### 3.3. 보안 (Security & Zero-Trust Blast Radius)
* [ ] **최소 권한의 원칙 (PoLP)**: ClusterRole에 `*` 와일드카드를 사용하지 않고, 필요한 리소스(`leases`, `events`, `nodes` 등)와 세부 verb만 명시했는가?
* [ ] **제어면 네임스페이스 격리**: 플랫폼 핵심 리소스(Lease, Secret, ConfigMap)가 `default`가 아닌 `kyverno-platform` 네임스페이스에 엄격히 격리되는가?
* [ ] **Blast Radius 격리 보장**: Hub 클러스터 제로-트러스트 관리 정책이 Spoke 클러스터나 프로덕션 워크로드 네임스페이스로 오배포되지 않도록 차단 경로가 격리되었는가?

### 3.4. 일관성 (Conventions & Standards)
* [ ] **에러 카탈로그 패턴 준수**: 비즈니스 예외 발생 시 하드코딩된 문자열이 아닌 `common/errors/business.exception.ts` 및 도메인 에러 상수를 사용하는가?
* [ ] **사전 보고 및 커밋 컨벤션 준수**: Conventional Commits v1.0.0 명세를 준수하며, 커밋 실행 전 사용자에게 커밋 대상과 메시지를 영어로 사전 보고하였는가?
* [ ] **모든 응답 언어 준수**: 사용자와의 상호작용 및 보고는 항상 한국어로 작성되었는가?

---

## 4. 단계별 순차적 개선 명세 (Phased Implementation Plan)

### Phase 1: [CRITICAL] Hub 격리 정책 경로 분리 및 리더 선출/Informer RBAC 정상화
> **목표**: Spoke 전체 워크로드 차단 위험을 물리적으로 제거하고, 리더 선출 403 에러를 해결하여 Informer/Watcher 실시간 감시 파이프라인을 복구합니다.

#### 1.1. 작업 내용
1. **Hub 격리 정책 디렉터리 분리**:
   - `k8s-manifests/policies/isolate-management-hub-cluster.yaml` ➡️ `k8s-manifests/policies-hub-only/isolate-management-hub-cluster.yaml` 로 이동.
   - Spoke Argo CD Application `01-spoke-governance-policies`가 `k8s-manifests/policies`를 재귀 탐색할 때 Hub 격리 정책을 읽어들이지 않도록 차단.
2. **Hub 백엔드 ClusterRole 권한 확장**:
   - 파일: `k8s-manifests/system/rbac.yaml`, `k8s-manifests/base/rbac.yaml`
   - `kyverno-backend-cluster-role`에 `coordination.k8s.io/leases`, `""/events`, `""/nodes` 리소스 권한 추가.
3. **백엔드 Deployment 환경변수 보완**:
   - 파일: `k8s-manifests/system/backend.yaml`
   - `K8S_LEASE_NAMESPACE: "kyverno-platform"`, `POD_NAME` (downward API) 주입.

#### 1.2. 코드 변경 명세
```yaml
# k8s-manifests/system/rbac.yaml
rules:
  # 코어 리소스에 events, nodes 추가
  - apiGroups: [""]
    resources: ["namespaces", "pods", "services", "configmaps", "persistentvolumeclaims", "events", "nodes"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # 리더 선출용 Leases 권한 추가
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # Argo CD 감시 권한 추가
  - apiGroups: ["argoproj.io"]
    resources: ["applications"]
    verbs: ["get", "list", "watch"]
```

```yaml
# k8s-manifests/system/backend.yaml (env 추가)
- name: K8S_LEASE_NAMESPACE
  value: "kyverno-platform"
- name: POD_NAME
  valueFrom:
    fieldRef:
      fieldPath: metadata.name
```

---

### Phase 2: [HIGH] Spoke 클러스터 노드 조회 권한 부여 및 관제 복구
> **목표**: Spoke 클러스터 개요 조회 시 `listNode()` 403 에러를 해결하고, 대시보드에서 노드 리스트와 CPU/Memory 할당 지표를 정상 출력합니다.

#### 2.1. 작업 내용
1. **Spoke 원격 에이전트 ClusterRole 권한 확장**:
   - 파일: `k8s-manifests/rbac/spoke-remote-agent-rbac.yaml`
   - Core API 리소스 목록에 `nodes` (`get`, `list`, `watch`) 권한 추가.
2. **Spoke 클러스터에 매니페스트 적용**:
   - `kubectl apply -f k8s-manifests/rbac/spoke-remote-agent-rbac.yaml --context=spoke` 실행.

#### 2.2. 코드 변경 명세
```yaml
# k8s-manifests/rbac/spoke-remote-agent-rbac.yaml
  - apiGroups:
      - ""
    resources:
      - namespaces
      - pods
      - events
      - services
      - configmaps
      - nodes
    verbs:
      - get
      - list
      - watch
```

---

### Phase 3: [HIGH] 정책(Policy) CRUD 완성 및 GitOps 퍼블리싱 파이프라인 연동
> **목표**: 정책 생성뿐만 아니라 수정/삭제 API를 완성하고, 정책 변경 시 GitOps 커밋/PR을 생성하여 Spoke Argo CD의 자동 삭제(Prune) 충돌을 방지합니다.

#### 3.1. 작업 내용
1. **KyvernoAdapter 정책 수정/삭제 K8s API 구현**:
   - 파일: `apps/backend/src/kubernetes/kyverno.adapter.ts`
   - `updateClusterPolicy`, `deleteClusterPolicy`, `updateNamespacedPolicy`, `deleteNamespacedPolicy` 구현.
2. **PoliciesService & Controller 엔드포인트 구현**:
   - 파일: `apps/backend/src/policies/policies.service.ts`, `policies.controller.ts`
   - `PUT /api/policies/:name`, `DELETE /api/policies/:name` 구현 및 `AuditLog` 기록 연동.
3. **GitOpsPublisher 정책 발행 기능 확장**:
   - 파일: `apps/backend/src/gitops/gitops-publisher.service.ts`
   - `publishPolicyManifest(policyManifest, clusterId)` 함수 구현.
   - 대상 저장소(`YeongrimGo/test-for`)의 `k8s-manifests/policies/<policy-name>.yaml` 경로로 Git 커밋/PR 발행.

#### 3.2. 핵심 코드 스니펫
```typescript
// apps/backend/src/kubernetes/kyverno.adapter.ts
async updateClusterPolicy(clusterId: string, name: string, manifest: Record<string, unknown>): Promise<void> {
  const { customObjectsApi } = this.clusters.get(clusterId);
  await customObjectsApi.replaceClusterCustomObject({
    group: "kyverno.io",
    version: "v1",
    plural: "clusterpolicies",
    name,
    body: manifest,
  });
}

async deleteClusterPolicy(clusterId: string, name: string): Promise<void> {
  const { customObjectsApi } = this.clusters.get(clusterId);
  await customObjectsApi.deleteClusterCustomObject({
    group: "kyverno.io",
    version: "v1",
    plural: "clusterpolicies",
    name,
  });
}
```

---

### Phase 4: [HIGH] PolicyDriftDetector의 정책(ClusterPolicy) 감시 확장
> **목표**: `PolicyDriftDetectorService`가 정책 예외뿐만 아니라 `ClusterPolicy` 변조/삭제 이벤트를 감지하고 거버넌스 인시던트를 자동 등록하도록 확장합니다.

#### 4.1. 작업 내용
1. **ClusterPolicy 이벤트 필터링 해제 및 핸들링**:
   - 파일: `apps/backend/src/kubernetes/reconciler/policy-drift-detector.service.ts`
   - `resourceType === "clusterpolicies"` 이벤트 처리 분기 추가.
2. **Git Baseline 매니페스트 해시 비교 로직 구축**:
   - GitOps 저장소(`k8s-manifests/policies`)에 정의된 정책 spec 해시와 런타임 이벤트의 spec 해시(`computeSpecHash`) 대조.
   - 불일치 시 `IncidentsService.createIncident` 호출하여 `DRIFT_DETECTED` 인시던트 발행.

#### 4.2. 핵심 코드 스니펫
```typescript
// apps/backend/src/kubernetes/reconciler/policy-drift-detector.service.ts
async handleResourceMutation(
  clusterId: string,
  resourceType: InformerResourceType,
  eventType: "add" | "update" | "delete",
  obj: KubernetesObject,
): Promise<DriftDetectionResult | null> {
  if (resourceType === "clusterpolicies") {
    return this.handleClusterPolicyDrift(clusterId, eventType, obj);
  }
  if (resourceType === "policyexceptions") {
    return this.handlePolicyExceptionDrift(clusterId, eventType, obj);
  }
  return null;
}
```

---

### Phase 5: [MEDIUM] 위반 식별자 Flapping 버그 개선 및 리포트 안정화
> **목표**: 배열 인덱스 기반의 위반 ID 체계를 결정론적 해시 식별자로 전면 개편하여 ID 플래핑 및 DB 상태 매핑 왜곡을 방지합니다.

#### 5.1. 작업 내용
1. **결정론적 Violation ID 생성 알고리즘 적용**:
   - 파일: `apps/backend/src/kubernetes/kyverno.adapter.ts` (L752), `apps/backend/src/violations/violations.service.ts`
   - `results` 배열 index 사용을 전면 폐기하고, 불변 필드(`clusterId`, `policyName`, `ruleName`, `resourceKind`, `resourceNamespace`, `resourceName`)의 조합을 SHA-256 해시하여 고유 ID 생성.
2. **주기적 리포트 동기화 시 분산 리더십 가드 적용**:
   - 파일: `apps/backend/src/violations/violations.service.ts`
   - 30초 동기화 타이머 실행 시 `K8sLeaderElectorService.isCurrentLeader()` 검사 추가.

#### 5.2. 핵심 코드 스니펫
```typescript
// Deterministic Violation ID Generator
export function generateDeterministicViolationId(
  clusterId: string,
  policyName: string,
  ruleName: string,
  resourceKind: string,
  resourceNamespace: string,
  resourceName: string,
): string {
  const rawKey = `${clusterId}:${policyName}:${ruleName}:${resourceKind}/${resourceNamespace}/${resourceName}`;
  const hash = createHash("sha256").update(rawKey).digest("hex").slice(0, 16);
  return `viol-${hash}`;
}
```

---

## 5. 검증 계획 (Verification Plan)

### 5.1. 자동화 테스트 (Automated Tests)
각 Phase 완료 시 아래 테스트 커맨드를 순차적으로 실행하여 회귀 버그가 없음을 보증합니다:

```bash
# 1. 단위 테스트 및 회귀 검증
pnpm --filter kyverno-backend test src/kubernetes/coordination/k8s-leader-elector.service.spec.ts
pnpm --filter kyverno-backend test src/kubernetes/k8s-informer.service.spec.ts
pnpm --filter kyverno-backend test src/kubernetes/watchers/admission-incident-watcher.service.spec.ts
pnpm --filter kyverno-backend test src/kubernetes/cluster-overview.service.ts
pnpm --filter kyverno-backend test src/kubernetes/reconciler/policy-drift-detector.service.spec.ts
pnpm --filter kyverno-backend test src/policies/policies.controller.spec.ts

# 2. 전체 빌드 및 린트 검증
pnpm lint
pnpm --filter kyverno-backend build
```

### 5.2. 실환경 E2E 검증 (Cluster Verification)
1. **리더 선출 및 실시간 감시 파이프라인 가동 확인**:
   - `kubectl logs -l app=kyverno-backend -n kyverno-platform --context=hub`
   - `[LeaderElector] Successfully acquired lease kyverno-platform/kyverno-platform-watcher-lease` 확인.
   - `[AdmissionWatcher] Leader lease acquired. Starting admission watchers...` 확인.
   - `[Informer] Leader lease acquired. Starting K8s informers...` 확인.
2. **Spoke 클러스터 노드 지표 확인**:
   - `curl -s http://localhost:3001/api/clusters/external-argocd-cluster/overview -H "Authorization: Bearer $TOKEN" | jq '.nodes'`
   - 노드 목록이 `null`이 아닌 정상 배열로 반환되는지 확인.
3. **Spoke Argo CD 동기화 안전성 확인**:
   - Spoke 클러스터에서 `kubectl get clusterpolicy --context=spoke | grep isolate` 실행 시 아무것도 나오지 않는지 확인 (Hub 격리 정책의 Spoke 유입 차단 검증).
4. **어드미션 차단 인시던트 폐루프(Closed-Loop) 검증**:
   - Spoke의 `governance-testbed` 네임스페이스에 비인가 파드 배포 ➡️ Kyverno 차단 ➡️ 백엔드 `IncidentsService`에 실시간 인시던트 등록 확인.

---

## 6. 에이전트 인계 실행 가이드 (Handoff Instructions)

후속 작업을 수행할 에이전트는 본 계획서를 기반으로 다음 절차에 따라 작업을 진행하십시오:

1. `git checkout -b fix/phase1-isolation-and-rbac` 브랜치를 생성하고 **Phase 1** 작업에 착수합니다.
2. 변경 사항을 구현한 후, 제3절의 **'품질 게이트 체크리스트'**를 바탕으로 셀프 코드리뷰를 수행합니다.
3. 제5절의 **자동화 테스트(`pnpm test`)**를 실행하여 100% 통과를 확인합니다.
4. 사용자 지침에 따라 **커밋 대상과 영문 Conventional Commit 메시지를 사용자에게 사전 보고**한 뒤 커밋합니다.
5. 순차적으로 Phase 2부터 Phase 5까지 동일한 사이클로 완료합니다.
