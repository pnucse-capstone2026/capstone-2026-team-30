# 9. Service Provider Interface (SPI) 패턴 기반 벤더 서비스(LLM, VCS, CD) 디커플링 및 플러그인 아키텍처

## Status

Accepted ( Yeongrim Go )

## Context

초기 **PaC Kyverno Governance Platform** 백엔드 아키텍처는 특정 클라우드 벤더 및 도구 체인 서비스에 강하게 결합(Strong Coupling)되어 있었습니다:

1. **Amazon Bedrock 고정 결합**: [`AiAgentService`](file:///home/user/kyverno-dashboard/apps/backend/src/ai-agent/ai-agent.service.ts) 및 [`WorkloadDiagnosticService`](file:///home/user/kyverno-dashboard/apps/backend/src/mlops/ai-assistant/workload-diagnostic.service.ts)가 `@aws-sdk/client-bedrock-runtime` SDK를 직접 인스턴스화하여 호출.
2. **GitHub REST API (Octokit) 고정 결합**: [`GitOpsService`](file:///home/user/kyverno-dashboard/apps/backend/src/gitops/gitops.service.ts) 및 [`GitOpsPublisherService`](file:///home/user/kyverno-dashboard/apps/backend/src/gitops/gitops-publisher.service.ts)가 `@octokit/rest` 라이브러리와 GitHub PR/Commit Status 엔드포인트에 직접 결합.
3. **Argo CD CRD 및 DB 컬럼 고정 결합**: [`AdmissionIncidentWatcherService`](file:///home/user/kyverno-dashboard/apps/backend/src/kubernetes/watchers/admission-incident-watcher.service.ts)가 Argo CD `Application` CRD 수신 메시지만 직접 처리하고, Prisma DB 스키마의 `DeploymentIncident` 모델에 `argoAppName` 컬럼 및 인덱스가 하드코딩.

이러한 강한 결합은 다음과 같은 운영 및 유지보수 문제를 야기했습니다:
- **확장성 제약**: OpenAI, Anthropic Direct API, Flux CD, GitLab, Bitbucket 등 다른 벤더/도구 서비스로 전환하거나 다중 지원을 추가할 때 비즈니스 로직을 대대적으로 수정해야 함.
- **로컬/폐쇄망 개발 제약**: 외부 AWS 또는 GitHub API 자격 증명이 없는 로컬 개발 또는 온프레미스 테스트 환경에서 서비스 동작이 제한됨.
- **단위 테스트 복잡성**: 비즈니스 로직 단위 테스트 시 외부 SDK 전체(@aws-sdk, @octokit/rest)를 거대하게 모킹(Mocking)해야 하여 테스트 가독성과 유지보수성이 저하됨.

## Decision

Service Provider Interface (SPI) 패턴과 NestJS 동적 팩토리(Dynamic Factory) 아키텍처를 도입하여 비즈니스 서비스 계층과 외부 벤더 구현체를 완전히 분리(Decoupling)합니다.

```
                       [ Kyverno Governance Platform ]
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │ (AI Engine)                │ (GitOps Engine)            │ (Incident Detection)
         ▼                            ▼                            ▼
  [ LlmProvider SPI ]          [ VcsProvider SPI ]         [ IncidentDetector SPI ]
  ├── BedrockLlmProvider       ├── GithubVcsProvider       ├── ArgoCdDetector
  ├── OpenAiLlmProvider (TODO) ├── GitlabVcsProvider(TODO) ├── FluxCdDetector (TODO)
  └── NoopLlmProvider          └── LocalFileVcsProvider    └── K8sCoreEventDetector
```

### 1. AI LLM 엔진 추상화 (`LlmProvider` SPI)
- **인터페이스 계약**: [`LlmProvider`](file:///home/user/kyverno-dashboard/apps/backend/src/ai-agent/providers/llm-provider.interface.ts) 인터페이스 및 NestJS DI 토큰 `LLM_PROVIDER_TOKEN` 선언.
- **구현체 구립**:
  - `BedrockLlmProvider`: AWS Bedrock SDK Converse API 캡슐화.
  - `OpenAiLlmProvider`: OpenAI 호환 API 연동용 `// TODO` 스텁.
  - `NoopLlmProvider`: 외부 AI 서비스 미연동 시 룰 기반 엔진으로 즉시 폴백하는 스텁.
- **동적 주입 팩토리**: [`LlmProviderFactory`](file:///home/user/kyverno-dashboard/apps/backend/src/ai-agent/providers/llm-provider.factory.ts)를 통해 환경변수 `AI_PROVIDER` (`BEDROCK` | `OPENAI` | `NOOP`) 값에 따라 알맞은 프로바이더를 런타임에 주입.

### 2. VCS / CI 엔진 추상화 (`VcsProvider` SPI)
- **인터페이스 계약**: [`VcsProvider`](file:///home/user/kyverno-dashboard/apps/backend/src/gitops/providers/vcs-provider.interface.ts) 인터페이스 및 `VCS_PROVIDER_TOKEN` 선언.
- **구현체 구립**:
  - `GithubVcsProvider`: GitHub Octokit REST API (PR 개설, Review Comment 작성, Commit Status 발송) 캡슐화.
  - `GitlabVcsProvider`: GitLab MR 및 Commit Status 연동용 `// TODO` 스텁.
  - `LocalFileVcsProvider`: 외부 VCS 연동 없이 로컬 파일시스템에만 매니페스트를 저장하는 독립 실행 어댑터.
- **동적 주입 팩토리**: [`VcsProviderFactory`](file:///home/user/kyverno-dashboard/apps/backend/src/gitops/providers/vcs-provider.factory.ts)를 통해 환경변수 `GITOPS_VCS_PROVIDER` (`GITHUB` | `GITLAB` | `LOCAL_FILE`) 기반 주입.

### 3. GitOps 인시던트 감지 추상화 (`IncidentDetector` SPI)
- **인터페이스 계약**: [`IncidentDetector`](file:///home/user/kyverno-dashboard/apps/backend/src/kubernetes/watchers/interfaces/incident-detector.interface.ts) 인터페이스 및 `AdmissionIncidentEvent` 공통 수신 계약 수립.
- **구현체 구립**:
  - `ArgoCdDetector`: Argo CD Application `syncResult` 수신 전담 감지기.
  - `K8sCoreEventDetector`: 표준 Kubernetes Core V1 Event 수신 전담 감지기.
  - `FluxCdDetector`: Flux CD (Kustomization / HelmRelease) 연동용 `// TODO` 스텁.
- **오케스트레이터 개편**: [`AdmissionIncidentWatcherService`](file:///home/user/kyverno-dashboard/apps/backend/src/kubernetes/watchers/admission-incident-watcher.service.ts)가 등록된 다중 감지기 이벤트를 통합 수집하여 배포 인시던트를 수집/전파.

### 4. DB 스키마 및 프론트엔드 벤더 중립화
- **Prisma DB Schema**: [`DeploymentIncident`](file:///home/user/kyverno-dashboard/apps/backend/prisma/schema.prisma) 모델의 `argoAppName` 컬럼 및 인덱스를 `gitopsAppName`으로 일반화.
- **Frontend API & UI**: DTO의 `provider` 타입을 `string`으로 확장하고, 프론트엔드 UI 라벨을 특정 브랜드(Bedrock, ArgoCD) 대신 **GitOps Engine**, **AI Assistant** 등 중립적 명칭으로 갱신.

## Consequences

### Positive
- **벤더 유연성 확보**: 신규 AI Provider(OpenAI, Ollama 등), VCS Provider(GitLab, Bitbucket), CD Detector(Flux CD) 추가 시 기존 비즈니스 서비스 로직 수정 없이 신규 클래스 구현 및 팩토리 등록만으로 확장 가능.
- **로컬 및 오프라인 개발 용이성**: `AI_PROVIDER=NOOP`, `GITOPS_VCS_PROVIDER=LOCAL_FILE` 설정을 통해 외부 클라우드 자격 증명 없이 완전히 독립적으로 로컬 개발 및 테스트 가능.
- **단위 테스트 가독성 향상**: 거대한 3rd-party SDK 모킹 대신 모의 `VcsProvider`, `LlmProvider` 객체를 주입하여 직관적이고 깔끔한 단위 테스트 작성 가능.

### Negative / Trade-offs
- **인터페이스 관리 오버헤드**: 벤더 고유 기능 추가 시 공통 SPI 인터페이스 계약 갱신이 필요함.
