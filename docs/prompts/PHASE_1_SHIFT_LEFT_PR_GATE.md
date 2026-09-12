# Phase 1 구현 프롬프트: Shift-Left PR 거버넌스 검증 엔진 및 GitHub PR Bot

> **문서 식별자**: `PROMPT-GITOPS-PHASE-1`  
> **선행 조건**: 기본 Kyverno 클러스터 연동 및 `SimulationService`, `AiAgentService`, `GitOpsPublisherService` 모듈 존재  
> **담당 대상**: 백엔드/프론트엔드 풀스택 AI 에이전트 또는 엔지니어  
> **핵심 원칙**: 
> 1. 범용 Copilot의 한계(확률적 검증, 4,000자 제한, 제로 클러스터 컨텍스트)를 극복하는 **클러스터 실제 정책 기반의 100% 결정론적(Deterministic) 검증** 제공.
> 2. etcd를 오염시키지 않는 **Server-Side Dry-Run (`dryRun: ['All']`)** 검증 방식 채택.
> 3. AI 제안 diff의 신뢰성 보장을 위한 **자가 재검증 루프(Self-Correction Loop)** 내장.

---

## 1. 구현 목표 (Objective)

개발자가 애플리케이션 리소스(Deployment, Service 등) 매니페스트를 변경하는 GitHub PR을 생성했을 때:
1. 변경된 매니페스트를 전달받아 타겟 클러스터의 실제 Kyverno 정책과 대조하여 **Server-Side Dry-Run 방식**으로 결정론적 정책 검증을 수행하는 API(`POST /api/v1/gitops/pr-review`)를 구현합니다.
2. 위반 발생 시 AWS Bedrock(`AiAgentService`)을 통해 교정 패치 diff를 생성하되, **반드시 백엔드 내부에서 재시뮬레이션을 통과한 패치만** GitHub PR 코멘트로 게시합니다.
3. 규정 준수가 즉시 불가능한 경우를 위해 리소스 메타데이터와 위반 정책이 자동 입력되는 **플랫폼 정책 예외 신청 딥링크**를 제공하고, 프론트엔드 신규 예외 신청 페이지(`/exceptions/new`)에서 쿼리 파라미터 자동 완성(Auto-fill)을 지원합니다.

---

## 2. 세부 작업 명세서 (Work Breakdown Structure)

### Task 1.1: `SimulationService` Server-Side Dry-Run 검증 메서드 구현
* **대상 파일**: `apps/backend/src/simulation/simulation.service.ts`
* **요구 사항**:
  - 임의의 K8s 매니페스트 YAML 문자열과 타겟 `namespace`, `clusterId`를 입력받는 `validateManifestDryRun()` 메서드 구현.
  - `@kubernetes/client-node`의 API를 활용하여 `dryRun: ['All']` 옵션을 지정한 서버사이드 드라이런 요청 수행.
  - 리소스 Kind에 따라 동적 API 디스패치(`CoreV1Api`, `AppsV1Api` 등) 또는 `KubernetesObjectApi` 활용.
  - Kyverno Admission Webhook의 403 차단 응답을 가로채어 정책명(`policyName`), 규칙명(`ruleName`), 차단 사유(`blockedReason`), 위반 경로를 구조화된 객체로 파싱 (`parseKyvernoBlockedError` 확장).
  - etcd에 실제 리소스가 영속화되지 않아야 함.

### Task 1.2: AI 자동 교정 패치 자체 재검증 루프 (Self-Correction Loop)
* **대상 파일**: `apps/backend/src/ai-agent/ai-agent.service.ts` 및 신규 PR 검증 서비스
* **요구 사항**:
  - `AiAgentService.generateFix()` 호출 후 반환된 수정 YAML에 대해 `SimulationService.validateManifestDryRun()`을 재호출.
  - 재검증 결과 여전히 정책 위반이 발생하거나 YAML 파싱 에러가 발생할 경우, 실패 사유를 프롬프트에 주입하여 최대 1회 재시도(Retry with Feedback).
  - 2회 시도 후에도 통과하지 못할 경우, 무리한 AI 패치 대신 사람이 수정할 수 있는 자연어 가이드만 코멘트에 포함하여 오탐 및 잘못된 코드 주입 원천 차단.

### Task 1.3: PR 검증 REST 엔드포인트 및 DTO 구현
* **대상 파일**: 
  - `apps/backend/src/gitops/dto/gitops-pr-review.dto.ts` (신규)
  - `apps/backend/src/gitops/gitops.controller.ts`
  - `apps/backend/src/gitops/gitops.service.ts`
* **요구 사항**:
  - `POST /api/v1/gitops/pr-review` 엔드포인트 정의 (Swagger `@ApiTags('GitOps Governance')`, `@ApiOperation`, DTO 검증).
  - DTO 명세:
    ```typescript
    export class GitOpsPrReviewDto {
      @ApiProperty({ description: 'GitHub 저장소 전체 이름 (예: org/repo)' })
      @IsString()
      repository: string;

      @ApiProperty({ description: 'Pull Request 번호' })
      @IsInt()
      pullNumber: number;

      @ApiProperty({ description: 'PR 대상 커밋 SHA' })
      @IsString()
      commitSha: string;

      @ApiProperty({ description: '타겟 클러스터 식별자', default: 'default' })
      @IsOptional()
      @IsString()
      clusterId?: string;

      @ApiProperty({ description: '배포 대상 네임스페이스' })
      @IsString()
      targetNamespace: string;

      @ApiProperty({ description: '변경/추가된 쿠버네티스 매니페스트 YAML 원문' })
      @IsString()
      manifestYaml: string;
    }
    ```
  - GitHub Octokit / REST API를 사용하여 해당 PR(`pullNumber`)에 규격화된 인라인 마크다운 코멘트 등록 (위반 테이블 + AI diff 제안 + 딥링크).
  - GitHub Commit Status / Check Runs API를 호출하여 PR Checks에 `failure` 또는 `success` 상태 전송.

### Task 1.4: 프론트엔드 예외 신청 딥링크 쿼리 파라미터 자동완성
* **대상 파일**: `apps/frontend/src/app/exceptions/new/page.tsx` (또는 관련 컴포넌트)
* **요구 사항**:
  - URL Query Parameters (`?repo=&pr=&cluster=&namespace=&policy=&rule=`) 파싱.
  - 페이지 진입 시 위 파라미터가 존재하면 폼 필드(대상 클러스터, 네임스페이스, 정책, 리소스 정보 등)에 초기값으로 자동 바인딩.
  - "GitHub PR #42 검증 결과로부터 자동 입력됨" 안내 배너 표시.

### 구현 참조 및 연동 단서 (Implementation Reference)
* **이중 인증(Dual Authentication)**: `apps/backend/src/gitops/guards/ci-or-jwt-auth.guard.ts` (Bearer JWT + `X-CI-Token`)
* **CI 연동 상세 가이드**: [`docs/guides/GITOPS_CI_INTEGRATION_GUIDE.md`](../guides/GITOPS_CI_INTEGRATION_GUIDE.md)
* **다중 리소스 지원**: `js-yaml.loadAll` 기반 일괄 Server-Side Dry-Run 지원

---

## 3. 검증 및 테스트 가이드 (Verification)

1. **단위/통합 테스트**:
   - `disallow-latest-tag` 정책이 활성화된 환경에서 `:latest` 태그를 가진 Pod YAML로 `POST /api/v1/gitops/pr-review` 호출 시 차단 리포트 반환 및 PR 코멘트 생성 확인.
   - AI 재검증 루프가 정상 동작하여 클린한 diff가 출력되는지 mock 테스트 작성.
2. **에러 처리 준수**:
   - `.agents/BACKEND_STANDARDS.md`를 준수하여 신규 비즈니스 에러(`GITOPS_ERROR.PR_REVIEW_FAILED`, `GITOPS_ERROR.GITHUB_API_ERROR` 등) 카탈로그 정의 및 `BusinessException` 사용.
3. **주석 및 커밋 규격**:
   - 모든 신규 클래스/함수에 JSDoc 작성.
   - 커밋 메시지 규격: `feat(gitops): implement shift-left PR review engine with server-side dry-run` 등 영어 작성 및 사전 보고.
