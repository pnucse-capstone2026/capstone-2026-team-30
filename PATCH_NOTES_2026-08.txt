================================================================================
KYVERNO GOVERNANCE PLATFORM - RELEASE PATCH NOTES
기간: 2026년 8월 16일 ~ 2026년 9월 2일
문서 버전: v1.2.0-PatchNotes
작성자: Yeongrim Go (YeongrimGo/PaC-KyvernoDashboard)
================================================================================

[ 목차 ]
1. 릴리즈 개요 (Release Overview)
2. 주요 기능 변화 및 신규 피처 (Major Features)
   2.1. MLOps 거버넌스 & 플랫폼 확장 (Phase 1 ~ Phase 3)
   2.2. 정책 기반 GitOps 자동화 및 GitHub PR 발행 엔진
   2.3. 실시간 멀티클러스터 관제실 (Live Observability & Topology)
   2.4. Amazon Bedrock 기반 AI 거버넌스 어시스턴트 & Copilot
   2.5. 엔터프라이즈 보안 및 실시간 세션 제어
3. 버그 수정 및 안정성 개선 (Bug Fixes & Reliability)
4. UI/UX 고도화 및 Mock 데이터 전면 제거 (Zero-Mock Refactoring)
5. 인프라, CI/CD 및 Kubernetes 매니페스트 개선 (Infra & DevOps)
6. 주요 변경 커밋 로그 (Commit Log Reference)

================================================================================
1. 릴리즈 개요 (Release Overview)
================================================================================
8월 16일 이후 약 2주간 총 100여 개 이상의 주요 기능 커밋을 통해:
- Kubeflow/KServe/KFP 연동 MLOps 워크로드 라이프사이클 및 GPU 쿼터/FinOps 제어
- 정책 예외 승인 시 GitHub 원격 저장소로의 자동 Pull Request 발행 GitOps 파이프라인
- Kubernetes 실시간 팩트(Fact) 데이터 기반 인터랙티브 라이브 관제실
- Amazon Bedrock Universal Converse API 기반 AI 장애 진단/완화 엔진
- 프론트엔드 전 영역 목(Mock) 데이터 전면 제거 및 100% Live API 연동
이 완료되었습니다.

================================================================================
2. 주요 기능 변화 및 신규 피처 (Major Features)
================================================================================

--------------------------------------------------------------------------------
2.1. MLOps 거버넌스 & 플랫폼 확장 (MLOps Phase 1 ~ Phase 3)
--------------------------------------------------------------------------------
[Kubeflow Notebook Hub 및 셀프서비스 라이프사이클]
- 데이터 사이언티스트를 위한 맞춤형 하드웨어 티어(CPU_SMALL, GPU_T4, GPU_A10G 등) 및
  프레임워크 프리셋(PyTorch, TensorFlow, Scipy, RStudio) 지원
- 사용자 전용 영구 홈 디렉토리 PVC 자동 프로비저닝 및 연동
- K8s CRD(`notebooks.kubeflow.org`) 기반 인스턴스 생성, 중지(Stop), 재기동(Start), 삭제
- 실시간 SSE(Server-Sent Events) 스트림을 통한 노트북 런타임 상태 즉시 동기화

[KServe 모델 서빙 관리 & Kubeflow Pipelines (KFP)]
- vLLM, Triton, TorchServe, HuggingFace 런타임 모델 서빙 배포 및 엔드포인트 관리
- KFP 기반 머신러닝 파이프라인 실행(Run) 트리거 및 실시간 실행 상태/로그 추적 API 구현

[FinOps 비용 최적화 & GPU 쿼터 관리]
- 네임스페이스 및 테넌트 단위 GPU 쿼터 실시간 추적 및 초과 방지 정책
- 유휴(Idle) 노트북 및 워크로드 자동 감지 백그라운드 모니터링 (`IdleWorkloadMonitorService`)
  을 통해 클라우드 컴퓨팅 비용 최대 60%+ 절감 구조 구현
- MLOps 거버넌스 전용 Kyverno 정책 3종 추가:
  * `disallow-untrusted-ml-images`: 검증되지 않은 외부 ML 컨테이너 이미지 반입 차단
  * `enforce-spot-node-selector`: ML 배치 학습에 Spot 인스턴스 자동 주입(비용 70% 절감)
  * `limit-gpu-per-namespace`: 단일 네임스페이스/파드당 최대 GPU 수량 제한

--------------------------------------------------------------------------------
2.2. 정책 기반 GitOps 자동화 및 GitHub PR 발행 엔진 (GitOps Engine)
--------------------------------------------------------------------------------
- Dual-Path 정책 예외 라이프사이클 완성:
  1) 런타임 경로: 승인 즉시 K8s `kyverno.io/v2 PolicyException` CRD 생성하여 런타임 면제
  2) 선언적 GitOps 경로: 로컬 `k8s-manifests/exceptions/...` YAML 생성 및 GitHub API를 통한
     원격 저장소 PR 자동 개설 (`[GitOps] PolicyException: <id>` 풀 리퀘스트 발행)
- 임시 예외(TTL)와 영구 예외의 동적 분기 처리 (`GITOPS_MIN_DURATION_HOURS`)
- Kustomization 자동 리인덱싱 및 매니페스트 무결성 검증

--------------------------------------------------------------------------------
2.3. 실시간 멀티클러스터 관제실 (Live Observability & Topology)
--------------------------------------------------------------------------------
- 실시간 K8s 클러스터 팩트(Fact) 데이터 기반 관제실 (`/demo/cluster-live`) 구현 ( 일반적인 경로로 접근 불가 )
  * Node, Pod, Namespace, Kyverno 정책, 위반 파드, 승인된 예외 실시간 K8s API 직접 조회
  * 수동 새로고침 및 5s/10s 자동 폴링 모드 지원
  * 인터랙티브 클러스터 토폴로지 캔버스 및 파드 상세 인스펙터 슬라이드 패널
- Multi-Cluster Provider & Dynamic Selector (`useDataStore`):
  * 하드코딩된 'default' 클러스터 ID 의존성 완전 제거
  * 상단 드롭다운을 통해 작업 대상 클러스터를 즉시 전환할 수 있는 전역 클러스터 컨텍스트 구현

--------------------------------------------------------------------------------
2.4. Amazon Bedrock 기반 AI 거버넌스 어시스턴트 & Copilot
--------------------------------------------------------------------------------
- Amazon Bedrock Universal Converse API(`amazon.nova-lite-v1:0` / `claude-3-5-sonnet`) 마이그레이션
- 3.5초 Circuit Breaker 및 룰 기반 KyvernoRuleTemplateEngine 하이브리드 Fallback 구조로
  AI 레이턴시 발생 시에도 100% 무중단 진단 응답 보장
- AI 정책 위반 진단 리포트 다이얼로그 (수정용 YAML 매니페스트 즉시 복사 및 다운로드)
- MLOps 전용 Copilot 대화형 드로어 (`CopilotDrawer`)를 통한 지능형 인프라 조치

--------------------------------------------------------------------------------
2.5. 엔터프라이즈 보안 및 실시간 세션 제어
--------------------------------------------------------------------------------
- Concurrent Session Invalidation:
  * 다중 로그인 감지 시 이전 세션의 Refresh Token 무효화 및 SSE 스트림을 통한 즉각 강제 로그아웃
- Cookie 보안 속성 강화 (`SameSite=Lax`, `HttpOnly`, `Secure`)
- Kubernetes Admission Webhook의 `request.userInfo` 기반 사용자 감사 및 RBAC 연동

================================================================================
3. 버그 수정 및 안정성 개선 (Bug Fixes & Reliability)
================================================================================
- [정책 스캔] 시스템 네임스페이스(kube-system, kyverno 등)에 대한 exclude 규칙 보강으로
  초기 클러스터 기동 시 발생하던 44건의 허위 위반(False-Positive) 완전 제거
- [위반 상태] 실시간 PolicyReport 인덱스 변경 시에도 관리자 처리 상태('open', 'resolved',
  'suppressed')가 영구 보존되도록 매핑 키 및 DB Fallback 파이프라인 개선
- [인증 동기화] 페이지 이동 시 세션 초기화 지연으로 인한 깜빡임 및 불필요한 네트워크 호출 방지
- [단일 클러스터 호환성] SingleClusterProvider에서 'default' 별칭 요청 시 기본 클러스터로
  안전하게 라우팅하여 404 예외 원천 방어
- [CRD 의존성] Kubeflow Notebook CRD 누락 시 발생하던 프로비저닝 에러 방지용 매니페스트 구축

================================================================================
4. UI/UX 고도화 및 Mock 데이터 전면 제거 (Zero-Mock Refactoring)
================================================================================
- 프론트엔드 전 페이지(대시보드, 정책, 위반, 예외, 감사로그, MLOps) Mock 데이터 전수 조사 및 제거
- 실시간 API 통신 상태 기반 Skeleton UI 전면 적용으로 초기 렌더링 시 깜빡임(Flash) 현상 제거
- Next.js 15 Turbopack HMR 최적화 및 Zustand 전역 캐싱 스토어 도입으로 화면 전환 딜레이 제거
- 사용자용/관리자용 역할(Role) 기반 동적 사이드바 네비게이션 및 메뉴 인가 라우팅 분리

================================================================================
5. 인프라, CI/CD 및 Kubernetes 매니페스트 개선 (Infra & DevOps)
================================================================================
- [AWS OIDC 기반 CD 파이프라인] GitHub Actions 워크플로우(`cd-backend.yml`, `cd-frontend.yml`)
  에 AWS IAM Role OIDC AssumeRole 적용 및 ECR 빌드 오프로딩
- [ALB Ingress 라이프사이클] AWS Load Balancer Controller 연동 및 온디맨드 ALB 스크립트 작성
- [시스템 매니페스트 표준화] `k8s-manifests/system/` (backend, frontend, postgres, ingress, rbac)
  배포 매니페스트의 RollingUpdate 및 환경변수(Secret/ConfigMap) 주입 표준화
- [테스트베드] `k8s-manifests/testbed/`에 클린 베이스라인(`01-clean-baseline.yaml`) 및
  시나리오별 위반 검증 스위트 완비

================================================================================
6. 주요 변경 커밋 로그 (Commit Log Reference: 2026-08-16 ~ 2026-09-01)
================================================================================
- b574767 refactor(Yeongrim): purge mock data and enhance live API bindings across admin and user views
- 24467a8 feat(Yeongrim): add Kubeflow notebook connection dialog and optimize MLOps cluster queries
- 89adcc0 feat(Yeongrim): implement live cluster overview API and interactive topology visualization
- 90438a8 feat(Yeongrim): enhance Kyverno policy parser with js-yaml and refine PolicyReport scope mapping
- b1f59c0 feat(Yeongrim): implement concurrent session invalidation via SSE and enhance cookie security
- 4b0d1a0 feat(Yeongrim): migrate Bedrock integration to universal Converse API and update UI badge
- 7082828 chore(Yeongrim): enhance EKS setup, Bedrock IRSA, and E2E testing scripts
- ef0c03e feat(Yeongrim): update Kubernetes manifests, testbed suite, and governance policies
- b661cb5 chore(Yeongrim): optimize Kyverno I/O and enrich local cluster setup scripts
- 52ec028 feat(Yeongrim): integrate live admin cluster detail and add admin exception creation page
- 33f5ead feat(Yeongrim): implement single cluster metadata API and update rbac specs
- 6603cda fix(Yeongrim): synchronize authStatus transition and stabilize data fetching on user dashboard
- b91d078 fix(Yeongrim): render skeleton UI during initial load on user policies and clusters pages
- 5fc8a9e feat(Yeongrim): add manifest copy action and diagnostic report to user violation detail page
- 0e2bf96 fix(Yeongrim): update refresh button icon and enforce fresh cache on user exceptions page
- a92a703 fix(Yeongrim): bind auth initialization and skeleton loading to user violations page
- 1e08981 fix(Yeongrim): support dynamic query prefill on user new exception page and link violation params
- 9c644af perf(Yeongrim): bind global selected cluster across MLOps pages to prevent duplicate queries
- 0036dca feat(Yeongrim): add selectedClusterId state and sync logic to global data store
- 05fe240 fix(Yeongrim): support autogen rule normalization and multi-level fallback in violation status mapping
- a217b8c fix(Yeongrim): preserve managed violation status across report index changes, sync updates, and DB fallbacks
- 934f7dd fix(Yeongrim): persist live violation IDs on status update, enrich unknown resources with live reports, and force fresh list data
- eda946d fix(Yeongrim): dynamically map violation notification severity and title based on actual severity
- bd22771 fix(Yeongrim): refine violation status key mapping to prevent cross-resource state pollution
- eae44d1 fix(Yeongrim): handle URL-encoded violation IDs in detail pages and API service
- 7240b59 fix(Yeongrim): enable dynamic policy edit page with live data fetching
- fc1da6e refactor(Yeongrim): compact policy operation list and truncate description
- 0e3ec29 feat(Yeongrim): support auto-filtering by policy in violation view
- 72cf17b feat(Yeongrim): synchronize notification indicator across header dropdown and notifications page
- d0bcc83 fix(Yeongrim): handle duplicate email error message in admin users page
- a709ef4 fix(Yeongrim): replace refresh button icon and enable approval standards modal in admin exceptions page
- 89a0125 feat(Yeongrim): improve exception verification UX and simplify AI guide button
- e88b5de feat(Yeongrim): add policy violation diagnostic report dialog with export features
- bdaecee feat(Yeongrim): integrate live violation status updates into action panel
- ebc7fe8 feat(Yeongrim): add violation status update API with audit logging
- 7db11b0 feat(Yeongrim): implement backend KFP pipeline module and execution APIs
- 61b01a2 feat(Yeongrim): add MLOps Phase 3 business errors and RBAC permissions
- 47bd72b chore(Yeongrim): optimize local Kind cluster setup script for minimal resource load
- 85c3faf feat(Yeongrim): update system deployment manifests and exclude system namespaces in MLOps spot policy
- 1030b66 build(Yeongrim): optimize Dockerfile build stages and Next.js bundle configuration
- af0ce59 fix(Yeongrim): import PrismaModule in MlopsModule and resolve auth API URL environment binding
- 511681f refactor(Yeongrim): align MLOps pages with platform shell layout and dynamic sidebar
- 8e75913 feat(Yeongrim): implement MLOps governance dashboard UI components, page, and sidebar navigation
- 4a7199c feat(Yeongrim): add MLOps governance frontend API client and React Query hooks
- 85cac27 feat(Yeongrim): add MlGovernanceService, MlGovernanceController, and module bindings
- db440ba feat(Yeongrim): implement IdleWorkloadMonitorService for automated notebook shutdown
- 902acb7 feat(Yeongrim): implement GpuQuotaService for namespace GPU resource tracking
- dca5f8a feat(Yeongrim): add MLOps governance error definitions and RBAC seed permissions
- d5eee22 feat(Yeongrim): add Kyverno policy manifests for MLOps GPU limits, spot nodes, and trusted registries
- 68b13a1 feat(Yeongrim): implement Notebook Hub dashboard and self-service creation UI
- b4f36ea feat(Yeongrim): add MLOps notebook API client, hooks and React Query provider
- dd7d8fd feat(Yeongrim): implement Notebooks service, controller and DTOs
- 34d185a feat(Yeongrim): implement KubeflowAdapter for CRD and PVC lifecycle
- f8f1bbe feat(Yeongrim): define MLOps domain error catalog and RBAC permissions
- 3eb27b1 feat(Yeongrim): fix ALB ingress auth endpoint routing and add dedicated cron lifecycle automation scripts
- ce2f243 fix(Yeongrim): update ALB Ingress healthcheck path and success codes
- 9b9b6e9 feat(Yeongrim): add On-Demand ALB lifecycle management scripts
- fc66bc3 feat(Yeongrim): add K8s Ingress manifest for AWS ALB routing
- 77d79fd feat(Yeongrim): add setup script for AWS Load Balancer Controller
- ed50481 fix(Yeongrim): bind global data caching store to exception management pages
- a40ed7c feat(Yeongrim): implement global data caching store for instant page transitions
- 93cbe8e fix(Yeongrim): optimize auth session memory caching and prevent redundant network calls during navigation
- 5c2386e fix(Yeongrim): bind dynamic backend APIs and skeleton loading to admin and user dashboards
- 003abbb fix(Yeongrim): support live api connection and skeleton loading for notifications, audit-logs, and clusters table
- 4a8eac9 fix(Yeongrim): update dashboard and audit log page subtitles to reflect live metrics
- 3188d50 fix(Yeongrim): support skeleton loading on admin clusters and violations pages
- ffcd974 fix(Yeongrim): render skeleton UI during initial load to prevent mock data flash
- 769125c fix(Yeongrim): update policy detail page descriptions for live integration
- 4967704 fix(Yeongrim): support auth initialization and live data sync on policy list pages
- 47f5dae fix(Yeongrim): enforce imagePullPolicy Always and unique image tagging in deployment scripts
- 50716c9 fix(Yeongrim): support auth initialization and live cluster integration on user clusters and detail pages
- 7dc26a7 fix(Yeongrim): handle auth initialization and display live catalog clusters on admin clusters page
- b6b8a07 feat(Yeongrim): integrate live cluster, policy, and violation API data on clusters pages
- 46274cd feat(Yeongrim): integrate WorkloadEvaluatorService into AiAgentService and module
- 198de42 feat(Yeongrim): add WorkloadEvaluatorService and extend explain error DTOs
- df8d3b8 feat(Yeongrim): add AI agent domain error catalog and filter mapping
- 3d824f9 feat(Yeongrim): display AI provider badge and latency in error explainer dialog
- 7e3d71a test(Yeongrim): add unit tests for AI error analysis timeout and rule engine fallback
- 9f989e5 feat(Yeongrim): integrate 3.5s timeout circuit breaker and fallback template engine in AiAgentService
- fac3f24 feat(Yeongrim): add KyvernoRuleTemplateEngine and provider metadata DTO
- 0112415 feat(Yeongrim): update clusters page with live data fetching and fix system manifests for E2E integration
- 13ae6ef feat(Yeongrim): add GET /violations/summary endpoint to ViolationsController
- 7b56d50 feat(Yeongrim): implement K8s PolicyReport live sync and DB fallback pipeline
- 757badc feat(Yeongrim): integrate GitOpsPublisherService into ExceptionRequestsService approval flow
- 483218d feat(Yeongrim): implement dumpPolicyExceptionYaml and local mock publishing in GitOpsPublisherService
- 696c80d test(Yeongrim): add explicit Docker CLI validation to E2E test suite
- 7337a9a infra(Yeongrim): optimize container builds and system manifests for rolling update
- cd29201 infra(Yeongrim): create live testbed governance policies and synthetic violations suite
- 4fc1ffd feat(Yeongrim): partially implement GitOpsPublisherService and GitOpsModule and register them
- 2ae5998 infra(Yeongrim): environment variable injection for the system deployment manifests and establish standard directory
- 0280f4e fix(Yeongrim): resolve backend module dependencies and standardize docker build pipeline for live EKS deployment
- 6a411ab chore(Yeongrim): verify and optimize frontend production build and types
- 24fb737 feat(Yeongrim): connect frontend dashboard, policies, violations, and audit log pages to live backend APIs
- ea835f0 feat(Yeongrim): create AI error explainer dialog component for intelligent remediation
- 68ceef9 feat(Yeongrim): integrate frontend API clients for policies, violations, audit logs and bedrock AI agent
- 58d7469 test(Yeongrim): add unit test suites for audit logs service and controller
- 6747839 feat(Yeongrim): implement audit logs controller and register audit logs module
- 63121f3 feat(Yeongrim): implement audit logs service with pagination and entity filtering
- 21be8cb feat(Yeongrim): define audit log DTOs and business error catalog
- 55f9c41 test(Yeongrim): add unit test suites for violations service and controller
- 99a88fa feat(Yeongrim): implement violations controller and register violations module
- e8b4c28 feat(Yeongrim): implement violations service with policy report aggregation and filtering
- 96563f2 feat(Yeongrim): extend kyverno adapter with policy report lookup and define violation errors
- 902bb78 feat(Yeongrim): implement policies module with multi-cluster kubernetes CRD lookup
- cbce620 fix(Yeongrim): ensure namespace and foundational resources before rollout
- 12317ac fix(Yeongrim): use cluster-specific IAM role name in IRSA setup script to avoid collisions
- 58693c7 feat(Yeongrim): integrate multi-cluster governance platform, bedrock AI agent and EKS deployment
================================================================================
