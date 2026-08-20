## Kyverno v1.12 PolicyException 스키마 (CRD Spec)

백엔드에서 YAML 생성 시 참조

* **`apiVersion`**: `kyverno.io/v2beta1`
* **`kind`**: `PolicyException`

### 필수 레이블 (Labels)
* `app.kubernetes.io/managed-by`: `"pac-kyverno-dashboard"`
* `pac.kyverno.io/request-id`: DB `PolicyExceptionRequest.id` (UUID)
* `pac.kyverno.io/target-cluster`: 대상 클러스터 식별자 (`targetClusterId`)

### 권장 애노테이션 (Annotations)
* `pac.kyverno.io/requester-id`: 요청 사용자 ID (`requestUserId`)
* `pac.kyverno.io/approver-id`: 승인 관리자 ID (`approverUserId`)
* `pac.kyverno.io/expires-at`: ISO-8601 UTC 만료 일시 (`expiresAt.toISOString()`)
* `pac.kyverno.io/reason`: 사유 문자열 (`reason`)

---

## 파일경로 및 헬퍼

```typescript
/**
 * 예외 매니페스트 파일 저장 상대 경로 계산 권장 예시
 */
export function getGitOpsRelativePath(
  clusterId: string,
  namespace: string,
  name: string,
): string {
  const safeCluster = clusterId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `k8s-manifests/exceptions/${safeCluster}/${safeNamespace}/${safeName}.yaml`;
}
```

---

## 백엔드 배포 환경변수 (ConfigService 연동)

백엔드 파드에는 다음 환경변수가 주입되어 탑재되어 있음 ([`k8s-manifests/system/backend.yaml`](file:///home/user/kyverno-dashboard/k8s-manifests/system/backend.yaml)):

1. **`GITOPS_PUBLISHING_MODE`**:
   - `DUAL_PATH` (기본값): In-Cluster K8s API 즉시 반영 + GitOps 레포 파일 비동기 커밋 병행.
   - `STRICT_GITOPS`: K8s API 직접 생성을 생략하고 Git 커밋만 수행(GitOps only)
   - `RUNTIME_ONLY`: Git 커밋을 생성하지 않고 클러스터 K8s API로만 런타임 관리(or not...why would someone need this?)
2. **`GITOPS_MIN_DURATION_HOURS`**:
   - 기본값: `"24"`
   - 잔여 수명(TTL)이 지정된 시간 미만인 단기 임시 예외는 Git 커밋을 생략(Skip)하여 Git 커밋 히스토리 오염(예외 리소스 관련 커밋으로 히스토리가 오버런 되는) 방지
