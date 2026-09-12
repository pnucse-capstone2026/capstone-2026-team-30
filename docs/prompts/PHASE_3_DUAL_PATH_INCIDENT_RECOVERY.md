# Phase 3 구현 프롬프트: 인시던트 원클릭 긴급 복구 UI 및 Dual-Path GitOps 복구 루프

> **문서 식별자**: `PROMPT-GITOPS-PHASE-3`  
> **선행 조건**: `Phase 2` (`DeploymentIncident` 인시던트 모델 및 감지 엔진) 완료 및 `GitOpsPublisherService` 모듈 연동  
> **담당 대상**: 프론트엔드/백엔드 풀스택 AI 에이전트 또는 엔지니어  
> **핵심 원칙**:
> 1. **Dual-Path 복구**: 배포 차단을 즉시 해소하는 "클러스터 런타임 직접 적용(Dynamic Apply)"과 GitOps 선언성을 보장하는 "저장소 비동기 PR 발행"의 병행.
> 2. **GitOps 드리프트 방지(Drift Control)**: 런타임에 주입되는 예외에 **임시 유효기간(TTL: 기본 24시간)**을 강제 부여하여 방치된 예외 자동 만료 처리.
> 3. 원클릭으로 5초 이내에 ArgoCD 배포를 복구시키는 압도적인 운영자 경험(UX) 제공.

---

## 1. 구현 목표 (Objective)

Kyverno 어드미션 차단으로 인해 ArgoCD 파이프라인이 정지된 인시던트에 대해:
1. 플랫폼 관리자 UI에 실시간 긴급 차단 배너 및 상세 모달을 노출합니다.
2. 관리자가 `[원클릭 긴급 복구 (PolicyException 발행)]`을 클릭하면, **백엔드가 클러스터 런타임에 임시 예외 CRD를 즉각 주입**하여 ArgoCD가 5초 이내에 자동 재시도하여 Sync를 통과하도록 합니다.
3. 동시에 GitOps 저장소에 해당 예외 매니페스트 PR을 백그라운드로 자동 발급하여 형상 관리의 단절(Drift)을 방지합니다.
4. 주기적인 드리프트 감지 워커(Cron)를 통해 GitOps PR이 머지되지 않고 방치되거나 거절된 예외를 추적하고 회수합니다.

---

## 2. 세부 작업 명세서 (Work Breakdown Structure)

### Task 3.1: 백엔드 Dual-Path 긴급 복구 오케스트레이션 엔드포인트
* **대상 파일**:
  - `apps/backend/src/incidents/incidents.controller.ts`
  - `apps/backend/src/incidents/incidents.service.ts`
  - `apps/backend/src/gitops/gitops-publisher.service.ts`
* **요구 사항**:
  - `POST /api/v1/incidents/:id/remediate` 엔드포인트 구현.
  - 요청 DTO: `ttlHours` (기본값 24), `reason` (긴급 복구 사유), `publishToGitOps` (기본값 true).
  - **Path 1 (클러스터 런타임 즉시 완화)**:
    - 차단된 인시던트의 리소스 정보(Kind, Name, Namespace) 및 정책/규칙명을 기반으로 `kyverno.io/v2beta1` `PolicyException` YAML 생성.
    - 예외 스펙에 TTL 만료 라벨(`governance.kyverno.io/ephemeral-ttl: "86400"`) 및 생성 일시 주입.
    - `CustomObjectsApiFactory`를 통해 대상 EKS 클러스터에 즉시 Dynamic Create/Apply.
  - **Path 2 (GitOps 비동기 PR 발행)**:
    - `GitOpsPublisherService.publishManifest()`를 호출하여 GitOps 리포지토리의 지정 브랜치(예: `feature/exception-incident-${id}`)에 예외 YAML 커밋 및 PR 생성.
  - **상태 전이**:
    - `DeploymentIncident`의 상태를 `RESOLVED_BY_EXCEPTION`으로 변경, `resolvedAt`, `exceptionId` 갱신.
    - 트랜잭션(`prisma.$transaction`)으로 원자성 보장.

### Task 3.2: GitOps 드리프트(Drift) 감지 및 임시 예외 회수 워커 (Scheduler)
* **대상 파일**:
  - `apps/backend/src/incidents/workers/incident-drift-worker.service.ts` (신규)
  - `apps/backend/src/incidents/incidents.module.ts`
* **요구 사항**:
  - NestJS `@Cron(CronExpression.EVERY_HOUR)`을 사용하여 만료 기한(`ttlHours`)이 초과된 임시 `PolicyException` 스캔.
  - GitOps PR이 아직 `OPEN` 상태이거나 `CLOSED`(거부)된 상태에서 TTL이 지난 경우, 관리자 알림(Slack/이메일) 전송 및 정책에 따라 클러스터 임시 예외 자동 롤백(Delete).

### Task 3.3: 프론트엔드 실시간 배포 차단 배너 및 인시던트 모달 UI
* **대상 파일**:
  - `apps/frontend/src/app/dashboard/components/admission-incident-banner.tsx` (신규)
  - `apps/frontend/src/app/dashboard/components/incident-remediation-modal.tsx` (신규)
  - `apps/frontend/src/app/incidents/page.tsx` (신규 또는 대시보드 내 섹션)
* **요구 사항**:
  - **긴급 배너**: 활성(`ACTIVE`) 인시던트가 존재할 경우 대시보드 최상단에 애니메이션이 적용된 경고 배너 표시 ("🚨 1개의 클러스터 워크로드 배포가 Kyverno 정책에 의해 차단되었습니다").
  - **상세 및 복구 모달**:
    - 차단된 ArgoCD App 명, 리소스 명, 위반된 Kyverno 정책 및 거절 사유 시각화.
    - `[⚡ 원클릭 긴급 예외 발행 및 배포 재개]` 버튼 제공.
    - TTL 선택 슬라이더 (4시간, 12시간, 24시간, 7일).
    - 복구 진행 중 스피너 ➔ 5초 내 "클러스터 반영 완료 및 GitOps PR #12 발급됨" 성공 피드백 표시.

---

## 3. 검증 및 테스트 가이드 (Verification)

1. **E2E 복구 시나리오 검증**:
   - 목업 인시던트를 생성한 후 `POST /api/v1/incidents/:id/remediate` 호출 시:
     1. 타겟 클러스터에 `PolicyException` CRD가 실제로 등록되는지 확인.
     2. GitOps 저장소에 자동 PR이 생성되는지 확인.
     3. 인시던트 상태가 `RESOLVED_BY_EXCEPTION`으로 변경되는지 확인.
2. **권한 및 에러 검증**:
   - 관리자 권한(`incidents.remediate`)이 없는 사용자의 호출 차단 (`ForbiddenException`).
   - 이미 해결된 인시던트에 대한 중복 복구 요청 차단 (`INCIDENT_ERROR.ALREADY_RESOLVED`).
3. **주석 및 커밋 규칙**:
   - JSDoc 표준 준수.
   - 커밋 메시지 규격: `feat(incidents): add dual-path emergency remediation and drift worker` 등 영어 작성 및 사전 보고.
