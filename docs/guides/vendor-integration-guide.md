# 외부 서비스(LLM, VCS, CD) Provider 확장 개발 지침서

본 문서는 **PaC Kyverno Governance Platform**의 Service Provider Interface (SPI) 아키텍처에 따라 신규 AI 프로바이더(OpenAI, Ollama 등), VCS 프로바이더(GitLab, Bitbucket 등), CD 인시던트 감지기(Flux CD 등)를 구현하고 플랫폼에 등록하는 개발 지침을 설명합니다.

---

## 1. 개요: SPI 디커플링 구조

본 플랫폼은 특정 클라우드 벤더(Amazon Bedrock, GitHub Actions/REST API, Argo CD)에 직접 종속되지 않도록 **NestJS Dynamic Factory** 패턴 기반의 SPI 레이어를 제공합니다. 

```
                                [ NestJS Application ]
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            │                             │                             │
            ▼                             ▼                             ▼
    [ LlmProvider SPI ]           [ VcsProvider SPI ]        [ IncidentDetector SPI ]
    (AI LLM Provider)            (VCS / CI Provider)         (GitOps CD Incident)
```

---

## 2. 신규 LLM Provider 추가 방법 (예: OpenAI)

### 2.1. 인터페이스 확인
[`LlmProvider`](file:///home/user/kyverno-dashboard/apps/backend/src/ai-agent/providers/llm-provider.interface.ts) 인터페이스를 구현합니다:
```typescript
export interface LlmProvider {
  readonly providerType: string;
  generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    options?: GenerateCompletionOptions,
  ): Promise<string>;
}
```

### 2.2. Provider 클래스 작성
[`openai-llm.provider.ts`](file:///home/user/kyverno-dashboard/apps/backend/src/ai-agent/providers/openai-llm.provider.ts) 파일의 `// TODO` 주석을 해제하고 구현합니다:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, GenerateCompletionOptions } from './llm-provider.interface';

@Injectable()
export class OpenAiLlmProvider implements LlmProvider {
  readonly providerType = 'OPENAI';
  private readonly logger = new Logger(OpenAiLlmProvider.name);

  async generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    options?: GenerateCompletionOptions,
  ): Promise<string> {
    // 1. OpenAI SDK (openai package) 호출 구현
    // 2. ChatCompletion response 수신 및 백오프 예외 처리
    return response.choices[0].message.content;
  }
}
```

### 2.3. Provider Factory 등록
[`llm-provider.factory.ts`](file:///home/user/kyverno-dashboard/apps/backend/src/ai-agent/providers/llm-provider.factory.ts)의 `useFactory` 케이스에 `OPENAI`를 등록합니다:
```typescript
switch (providerEnv) {
  case 'OPENAI':
    return openAiProvider;
  case 'BEDROCK':
    return bedrockProvider;
  default:
    return noopProvider;
}
```

### 2.4. 환경변수 설정
`.env` 파일에 `AI_PROVIDER=OPENAI` 및 `OPENAI_API_KEY`를 설정합니다.

---

## 3. 신규 VCS / CI Provider 추가 방법 (예: GitLab)

### 3.1. 인터페이스 확인
[`VcsProvider`](file:///home/user/kyverno-dashboard/apps/backend/src/gitops/providers/vcs-provider.interface.ts) 인터페이스를 구현합니다:
```typescript
export interface VcsProvider {
  readonly providerType: string;
  createPullRequest(params: VcsCreatePrParams): Promise<VcsPrResult>;
  postReviewComment(params: VcsCommentParams): Promise<string | undefined>;
  setCommitStatus(params: VcsCommitStatusParams): Promise<void>;
}
```

### 3.2. Provider 클래스 작성
[`gitlab-vcs.provider.ts`](file:///home/user/kyverno-dashboard/apps/backend/src/gitops/providers/gitlab-vcs.provider.ts) 파일의 `// TODO` 주석을 해제하고 구현합니다:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { VcsProvider, VcsCreatePrParams, VcsPrResult } from './vcs-provider.interface';

@Injectable()
export class GitLabVcsProvider implements VcsProvider {
  readonly providerType = 'GITLAB';
  private readonly logger = new Logger(GitLabVcsProvider.name);

  async createPullRequest(params: VcsCreatePrParams): Promise<VcsPrResult> {
    // 1. GitLab REST API (Merge Request API) 호출
    // 2. MR 생성 URL 및 ID 반환
  }
}
```

### 3.3. Provider Factory 등록
[`vcs-provider.factory.ts`](file:///home/user/kyverno-dashboard/apps/backend/src/gitops/providers/vcs-provider.factory.ts)의 `useFactory` 케이스에 `GITLAB`을 등록합니다.

### 3.4. 환경변수 설정
`.env` 파일에 `GITOPS_VCS_PROVIDER=GITLAB` 및 `GITOPS_GITLAB_TOKEN`을 설정합니다.

---

## 4. 신규 GitOps CD Incident Detector 추가 방법 (예: Flux CD)

### 4.1. 인터페이스 확인
[`IncidentDetector`](file:///home/user/kyverno-dashboard/apps/backend/src/kubernetes/watchers/interfaces/incident-detector.interface.ts) 인터페이스를 구현합니다:
```typescript
export interface IncidentDetector {
  readonly detectorName: string;
  start(kubeConfig: KubeConfig, onIncident: (event: AdmissionIncidentEvent) => Promise<void>): Promise<void>;
  stop(clusterId: string): Promise<void>;
}
```

### 4.2. Detector 클래스 작성
[`fluxcd.detector.ts`](file:///home/user/kyverno-dashboard/apps/backend/src/kubernetes/watchers/detectors/fluxcd.detector.ts) 파일의 `// TODO` 주석을 해제하고 Flux CD CustomResource Watcher(Kustomization, HelmRelease)를 구현합니다.

### 4.3. Watcher Service 등록
[`admission-incident-watcher.service.ts`](file:///home/user/kyverno-dashboard/apps/backend/src/kubernetes/watchers/admission-incident-watcher.service.ts)의 `detectors` 배열에 `FluxCdDetector`를 주입합니다.

---

## 5. 단위 테스트 및 검증 절차

신규 Provider 구현 후 다음 검증 명령을 실행하여 정합성을 확인합니다:

```bash
# 1. 백엔드 TypeScript 타입 검사
pnpm --filter @kyverno-platform/backend exec tsc --noEmit

# 2. 백엔드 전체 린트 검사
pnpm --filter @kyverno-platform/backend lint

# 3. 신규 Provider 단위 테스트 실행
pnpm --filter @kyverno-platform/backend test -- src/ai-agent src/gitops src/kubernetes/watchers
```
