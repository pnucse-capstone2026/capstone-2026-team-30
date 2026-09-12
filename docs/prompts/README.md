# GitOps 리소스 거버넌스 구현 프롬프트 모음 (Implementation Prompts)

본 디렉토리는 `docs/temp/GITOPS_RESOURCE_GOVERNANCE_PROPOSAL.md` 제안서 및 쿠버네티스 엔터프라이즈 운영 실태 보고서에 기반하여 설계된 **단계별 구현 프롬프트(Prompt Specifications)**를 포함하고 있습니다.

각 프롬프트는 후속 개발을 담당하는 **AI 에이전트(Subagents)** 또는 **엔지니어**가 즉시 컨텍스트를 주입받아 독립적으로 작업을 수행할 수 있도록 독립 실행형(Self-contained) 규격으로 작성되었습니다.

---

## 📑 단계별 구현 프롬프트 목록

| 단계 | 프롬프트 파일 | 핵심 구현 내용 | 담당 영역 | 우선순위 |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | [`PHASE_1_SHIFT_LEFT_PR_GATE.md`](./PHASE_1_SHIFT_LEFT_PR_GATE.md) | **Shift-Left PR 거버넌스 검증 엔진 & GitHub PR Bot**<br/>- Server-Side Dry-Run (`dryRun: ['All']`) 검증<br/>- Bedrock AI 자가 재검증 루프 (Self-Correction Loop)<br/>- PR 인라인 위반 코멘트 및 플랫폼 예외 딥링크 | Backend, Frontend | **P0 (최우선)** |
| **Phase 2** | [`PHASE_2_ADMISSION_BLOCK_INCIDENT_TRACKING.md`](./PHASE_2_ADMISSION_BLOCK_INCIDENT_TRACKING.md) | **Closed-Loop Admission Block 감지 & 인시던트 트래킹**<br/>- ArgoCD Application Sync 차단 감지 리스너<br/>- `DeploymentIncident` Prisma 스키마 확장 및 API<br/>- 실시간 웹소켓 이벤트 브로드캐스트 | Backend, K8s Watcher | **P1** |
| **Phase 3** | [`PHASE_3_DUAL_PATH_INCIDENT_RECOVERY.md`](./PHASE_3_DUAL_PATH_INCIDENT_RECOVERY.md) | **인시던트 원클릭 긴급 복구 UI & Dual-Path GitOps 루프**<br/>- 런타임 즉시 완화(Dynamic Apply) + 비동기 Git PR<br/>- 임시 예외 만료(TTL) 및 GitOps 드리프트(Drift) 회수 워커<br/>- 대시보드 실시간 경고 배너 및 복구 모달 UI | Full-Stack | **P1** |
| **Phase 4** | [`PHASE_4_GOLDEN_PATH_SELF_SERVICE_PORTAL.md`](./PHASE_4_GOLDEN_PATH_SELF_SERVICE_PORTAL.md) | **Policy-Gated 골든 패스(Golden Path) 셀프서비스 포털**<br/>- 사내 보안 규격이 주입된 마이크로서비스 템플릿 엔진<br/>- 배포 전 무결점 사전 검증 (Pre-flight Validation)<br/>- 4단계 스텝형 웹 마법사 및 GitOps PR 자동 생성 | Full-Stack | **P2** |

---

## 🛠️ 공통 개발 및 코딩 표준 참조
모든 에이전트는 프롬프트 작업 시 아래 프로젝트 표준 규격을 엄격히 준수해야 합니다:
1. **백엔드 아키텍처 및 에러 처리**: [`.agents/BACKEND_STANDARDS.md`](../../.agents/BACKEND_STANDARDS.md)
   - 도메인별 에러 카탈로그(`*.errors.ts`) 및 `BusinessException` 사용.
   - 모든 Controller에 `@RequirePermissions()` 및 Swagger 데코레이터 적용.
   - 모든 Service 메서드에 `Cluster Scoping` 검증 적용.
2. **AI 에이전트 행동 지침**: [`.agents/AGENTS.md`](../../.agents/AGENTS.md)
   - 답변 언어는 항상 **한국어** 사용.
   - 커밋 메시지는 **영어 Conventional Commits** 사용 및 사용자에게 사전 보고.
   - 클래스 및 메서드에 **JSDoc (`/** ... */`)** 작성.
   - AWS 리전 표준: `us-east-1` (HA 시 `us-east-2`).
