# Phase 2 구현 프롬프트: Closed-Loop Admission Block 감지 및 인시던트 트래킹 엔진

> **문서 식별자**: `PROMPT-GITOPS-PHASE-2`  
> **선행 조건**: `Phase 1` 완료 또는 독립적 K8s 클러스터 연동(`ClusterProvider`), Prisma ORM 환경  
> **담당 대상**: 백엔드 시스템 AI 에이전트 또는 엔지니어  
> **핵심 원칙**:
> 1. K8s Event의 1시간 TTL 유실 한계를 극복하기 위해 **ArgoCD Application CRD Status Watch**를 우선 감지 소스로 활용.
> 2. 차단 이벤트를 단순 로그가 아닌 비즈니스 라이프사이클을 갖는 **`DeploymentIncident` 엔티티로 영속화**.
> 3. 멀티 클러스터 환경에서 테넌트 격리 및 클러스터 접근 권한(`user.clusterIds`) 철저 준수.

---

## 1. 구현 목표 (Objective)

ArgoCD가 GitOps 리포지토리의 매니페스트를 클러스터에 Sync할 때 Kyverno Admission Webhook에 의해 차단(`403 Forbidden` / `AdmissionWebhookDenied`)되어 파이프라인이 정지되는 인시던트를 실시간으로 포착하여:
1. 배포 차단 정보를 `DeploymentIncident` 데이터베이스 모델로 저장하고 라이프사이클을 추적합니다.
2. 플랫폼 대시보드가 실시간으로 차단 상황을 인지할 수 있도록 REST API 및 상태 변경 이벤트를 제공합니다.
3. 차단된 리소스와 관련된 GitOps 메타데이터(ArgoCD App 명, Git Repo, Commit SHA)를 바인딩하여 Phase 3(원클릭 복구)의 기반 데이터를 구축합니다.

---

## 2. 세부 작업 명세서 (Work Breakdown Structure)

### Task 2.1: Prisma Schema 확장 및 마이그레이션
* **대상 파일**: `packages/database/prisma/schema.prisma` (또는 백엔드 Prisma 스키마 위치)
* **요구 사항**:
  - `DeploymentIncident` 모델 및 `IncidentStatus` 열거형(Enum) 추가:
    ```prisma
    enum IncidentStatus {
      ACTIVE
      RESOLVED_BY_EXCEPTION
      RESOLVED_BY_HOTFIX
      IGNORED
    }

    model DeploymentIncident {
      id              String           @id @default(uuid())
      clusterId       String
      namespace       String
      resourceKind    String
      resourceName    String
      policyName      String
      ruleName        String?
      blockReason     String           @db.Text
      argoAppName     String?
      gitCommitSha    String?
      gitRepository   String?
      status          IncidentStatus   @default(ACTIVE)
      createdAt       DateTime         @default(now())
      resolvedAt      DateTime?
      exceptionId     String?          // PolicyExceptionRequest 연계 외래키
      metadata        Json?            // K8s 이벤트 상세 원문 등 보관
    }
    ```
  - `pnpm prisma db push` 또는 마이그레이션 스크립트 실행.

### Task 2.2: Admission 차단 감지 리스너 서비스 구현
* **대상 파일**: 
  - `apps/backend/src/kubernetes/watchers/admission-incident-watcher.service.ts` (신규)
  - `apps/backend/src/kubernetes/kubernetes.module.ts`
* **요구 사항**:
  - `ClusterProvider`를 통해 등록된 클러스터의 `CustomObjectsApi`를 사용하여 ArgoCD Application 리소스(`argoproj.io/v1alpha1/applications`) Watcher 가동.
  - `application.status.operationState.syncResult.resources[]` 배열 중 `hookStatus == "Failed"` 또는 `message`에 `denied the request` / `blocked due to the following policies`가 포함된 리소스 식별.
  - 보조 감지 소스: Kubernetes API Server의 `events.k8s.io`에서 `reason: "AdmissionWebhookDenied"` 이벤트 필터링 리스너 병행.
  - 중복 인시던트 방지(Deduplication): 동일 클러스터/네임스페이스/리소스/정책에 대해 이미 `ACTIVE` 상태인 인시던트가 존재할 경우 타임스탬프와 차단 횟수(count)만 갱신.

### Task 2.3: 인시던트 관리 서비스 및 도메인 에러 정의
* **대상 파일**:
  - `apps/backend/src/incidents/incidents.service.ts` (신규)
  - `apps/backend/src/incidents/incidents.controller.ts` (신규)
  - `apps/backend/src/incidents/incidents.errors.ts` (신규)
  - `apps/backend/src/incidents/dto/incident-query.dto.ts` (신규)
* **요구 사항**:
  - 에러 카탈로그(`INCIDENT_ERROR.NOT_FOUND`, `INCIDENT_ERROR.CLUSTER_ACCESS_DENIED` 등) 정의 및 전역 에러 카탈로그에 등록.
  - `GET /api/v1/incidents`: 상태(`status`), 클러스터(`clusterId`), 네임스페이스(`namespace`) 필터링 및 페이징 조회 API 구현.
  - `GET /api/v1/incidents/:id`: 단일 인시던트 상세 정보 및 차단된 YAML/정책 세부 내용 조회.
  - `PATCH /api/v1/incidents/:id/ignore`: 관리자가 해당 인시던트를 수동 무시(`IGNORED`) 처리하는 엔드포인트.
  - `@RequirePermissions('incidents.read')`, `@RequirePermissions('incidents.manage')` 권한 가드 적용.

### Task 2.4: 실시간 웹소켓/SSE 알림 브로드캐스트
* **대상 파일**: `apps/backend/src/incidents/incidents.gateway.ts` (또는 기존 WebSocket 모듈 연동)
* **요구 사항**:
  - 새로운 `DeploymentIncident`가 발생하거나 상태가 변경될 때 프론트엔드 대시보드 룸(`cluster:${clusterId}`)으로 `incident:created`, `incident:updated` 소켓 이벤트 브로드캐스트.

---

## 3. 검증 및 테스트 가이드 (Verification)

1. **테스트 시나리오**:
   - Kyverno 차단 웹훅 에러 문자열 모의(Mock) 데이터를 인포머 리스너에 주입하여 `DeploymentIncident` 테이블에 `ACTIVE` 상태로 레코드가 정상 적재되는지 검증.
   - 이미 존재하는 인시던트에 대해 동일 차단 이벤트가 들어왔을 때 레코드가 중복 생성되지 않는지 멱등성 검증.
   - `GET /api/v1/incidents` 엔드포인트에 비인가 클러스터 조회 요청 시 `BusinessException` 차단 확인.
2. **코딩 표준 준수**:
   - 모든 Service 메서드에 Cluster Scoping 검증(`user.clusterIds.includes(clusterId)`) 필수 적용.
   - JSDoc 작성 및 영어 Conventional Commits (`feat(incidents): implement admission block incident tracking engine`) 준수.
