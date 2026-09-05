## Kyverno v1.12 PolicyException 스키마 (CRD Spec)

백엔드에서 YAML 생성 시 참조

- **`apiVersion`**: `kyverno.io/v2beta1`
- **`kind`**: `PolicyException`

### 필수 레이블 (Labels)

- `app.kubernetes.io/managed-by`: `"pac-kyverno-dashboard"`
- `pac.kyverno.io/request-id`: DB `PolicyExceptionRequest.id` (UUID)
- `pac.kyverno.io/target-cluster`: 대상 클러스터 식별자 (`targetClusterId`)

### 권장 애노테이션 (Annotations)

- `pac.kyverno.io/requester-id`: 요청 사용자 ID (`requestUserId`)
- `pac.kyverno.io/approver-id`: 승인 관리자 ID (`approverUserId`)
- `pac.kyverno.io/expires-at`: ISO-8601 UTC 만료 일시 (`expiresAt.toISOString()`)
- `pac.kyverno.io/reason`: 사유 문자열 (`reason`)

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

3. **`EXCEPTION_APPROVED_RECHECK_INTERVAL_SECONDS`**:
   - 기본값: `"300"`
   - 정상 `APPROVED` PolicyException을 다시 확인하는 주기. 최소 10초이며 잘못된 값은 기본값을 사용

4. **`EXCEPTION_RECONCILE_CLAIM_TTL_SECONDS`**:
   - 기본값: `"60"`
   - 여러 백엔드 인스턴스가 같은 예외를 동시에 처리하지 않도록 유지하는 실행 claim TTL
   - Kubernetes GET과 CREATE가 연속 timeout될 수 있으므로 `2 × KUBERNETES_REQUEST_TIMEOUT_MS + 10초`보다 작으면 안전한 하한으로 자동 상향

### 리컨실러 lease migration 배포

`reconcileClaimId`/`reconcileLeaseUntil` migration 전후 버전은 서로 다른 lease 필드를 사용하므로 일반 rolling overlap을 허용하지 않습니다. migration 적용 후 기존 backend replica를 0으로 축소하고, 신버전을 배포한 뒤 replica를 복구합니다. 무중단 전환이 필요하면 구·신 lease를 함께 기록하는 별도 호환 릴리스가 필요합니다.
