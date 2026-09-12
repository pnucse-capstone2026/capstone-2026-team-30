# Phase 4 구현 프롬프트: Policy-Gated 골든 패스(Golden Path) 셀프서비스 포털

> **문서 식별자**: `PROMPT-GITOPS-PHASE-4`  
> **선행 조건**: `Phase 1` (`SimulationService.validateManifestDryRun`) 및 `GitOpsPublisherService` 모듈 연동  
> **담당 대상**: 프론트엔드/백엔드 풀스택 AI 에이전트 또는 엔지니어  
> **핵심 원칙**:
> 1. 개발자에게 생(Raw) YAML 작성을 강요하지 않고, 사내 보안 규정이 100% 주입된 **골든 패스(Golden Path) 템플릿** 제공.
> 2. 배포 요청 전에 타겟 클러스터 정책을 사전 검증(Pre-flight Check)하여 **무결점(Zero-Violation) 매니페스트만 GitOps 저장소로 발행**.
> 3. 마이크로서비스, 웹 프론트엔드, 백엔드 API 등 서비스 유형별 확장 가능한 **JSON Schema 기반 템플릿 엔진** 구축.

---

## 1. 구현 목표 (Objective)

개발자가 새로운 마이크로서비스를 쿠버네티스에 배포하고자 할 때:
1. 사내 규정(PodSecurityStandards, 허용 레지스트리, 리소스 쿼터, 레이블 규칙)을 몰라도 직관적인 웹 마법사 폼을 통해 서비스 필수 정보(앱 이름, 이미지 태그, 포트, 환경 변수 등)만 입력합니다.
2. 플랫폼이 사내 표준 보안 컨텍스트(`runAsNonRoot`, `readOnlyRootFilesystem`, `requests/limits` 등)가 완벽히 주입된 K8s 매니페스트(`Deployment`, `Service`, `Ingress`, `HPA`)를 자동 생성합니다.
3. 생성된 매니페스트를 Phase 1의 드라이런 엔진(`SimulationService.validateManifestDryRun`)으로 사전 검증하여 정책 위반이 0건임을 확인한 후, 타겟 GitOps 저장소로 자동 PR을 생성합니다.

---

## 2. 세부 작업 명세서 (Work Breakdown Structure)

### Task 4.1: 골든 패스 템플릿 엔진 및 백엔드 생성 API
* **대상 파일**:
  - `apps/backend/src/workloads/templates/workload-template.interface.ts` (신규)
  - `apps/backend/src/workloads/templates/microservice.template.ts` (신규)
  - `apps/backend/src/workloads/workloads.service.ts` (신규)
  - `apps/backend/src/workloads/workloads.controller.ts` (신규)
  - `apps/backend/src/workloads/dto/create-workload-request.dto.ts` (신규)
* **요구 사항**:
  - DTO 명세:
    ```typescript
    export class CreateWorkloadRequestDto {
      @ApiProperty({ description: '서비스 이름 (K8s 네이밍 규칙 준수)' })
      @IsString()
      serviceName: string;

      @ApiProperty({ description: '타겟 클러스터 식별자' })
      @IsString()
      clusterId: string;

      @ApiProperty({ description: '타겟 네임스페이스' })
      @IsString()
      namespace: string;

      @ApiProperty({ description: '컨테이너 이미지 (사내 ECR 경로 권장)' })
      @IsString()
      image: string;

      @ApiProperty({ description: '서비스 포트', default: 8080 })
      @IsInt()
      containerPort: number;

      @ApiProperty({ description: '환경 (dev / staging / prod)' })
      @IsEnum(['dev', 'staging', 'prod'])
      environment: string;

      @ApiProperty({ description: '외부 공개 Ingress 설정 여부', default: false })
      @IsBoolean()
      enableIngress: boolean;

      @ApiProperty({ description: 'Ingress 호스트 도메인', required: false })
      @IsOptional()
      @IsString()
      ingressHost?: string;

      @ApiProperty({ description: '리소스 티어 (small, medium, large)', default: 'small' })
      @IsEnum(['small', 'medium', 'large'])
      resourceTier: string;
    }
    ```
  - **사내 보안 가드레일 자동 주입**:
    - `securityContext`: `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities.drop: ["ALL"]`.
    - `resources`: 티어별 기본값 자동 매핑 (small: `cpu: 100m / 500m`, `memory: 128Mi / 256Mi` 등).
    - 표준 레이블: `app.kubernetes.io/name`, `app.kubernetes.io/managed-by: gitops-governance`, `environment`.
  - **사전 검증(Pre-flight Validation) 파이프라인**:
    - 생성된 YAML을 `SimulationService.validateManifestDryRun()`에 통과시켜 정책 위반 여부 최종 점검.
  - **GitOps PR 발행**:
    - `GitOpsPublisherService.publishManifest()`를 통해 지정된 GitOps 애플리케이션 리포지토리에 `apps/${serviceName}/` 디렉토리 구조로 파일 생성 및 PR 발송.

### Task 4.2: 프론트엔드 셀프서비스 배포 마법사 UI
* **대상 파일**:
  - `apps/frontend/src/app/workloads/new/page.tsx` (신규)
  - `apps/frontend/src/app/workloads/components/step-basic-info.tsx` (신규)
  - `apps/frontend/src/app/workloads/components/step-networking.tsx` (신규)
  - `apps/frontend/src/app/workloads/components/step-resources.tsx` (신규)
  - `apps/frontend/src/app/workloads/components/step-review-and-submit.tsx` (신규)
* **요구 사항**:
  - **4단계 스텝형 마법사 (Wizard UX)**:
    - 1단계: 기본 정보 (서비스명, 타겟 클러스터, 네임스페이스, 이미지 경로)
    - 2단계: 네트워크 및 Ingress (포트, 인그레스 활성화, 도메인 입력)
    - 3단계: 리소스 티어 및 인스턴스 개수 (Small / Medium / Large 카드 선택)
    - 4단계: 실시간 프리뷰 및 정책 사전 검증 결과
  - 4단계 프리뷰에서 생성될 YAML과 함께 **"✅ Kyverno 사내 정책 12개 검증 완료 (100% 규격 준수)"** 녹색 배지 표시.
  - `[🚀 GitOps PR 생성 및 배포 요청]` 버튼 클릭 시 저장소 PR 생성 후 PR 링크 모달 표시.

---

## 3. 검증 및 테스트 가이드 (Verification)

1. **테스트 시나리오**:
   - 프론트엔드 마법사에서 소형 서비스 입력 후 `POST /api/v1/workloads` 요청 시 생성된 YAML이 Kyverno 정책을 완벽히 통과하는지 검증.
   - 필수 보안 필드가 빠짐없이 렌더링되었는지 단위 테스트(`workload.template.spec.ts`) 작성.
   - GitOps 저장소에 적절한 디렉토리 구조로 PR이 생성되는지 엔드투엔드 mock 테스트.
2. **에러 처리 및 접근 제어**:
   - 비인가 네임스페이스나 클러스터 배포 요청 시 `WORKLOAD_ERROR.NAMESPACE_ACCESS_DENIED` 차단.
   - JSDoc 작성 및 영어 Conventional Commits (`feat(workloads): add golden path self-service deployment wizard`) 준수.
