# 7. 분산 작업 큐(BullMQ) 및 토큰 버킷 기반의 외부 API(Bedrock/GitHub) Quota 보호

## Status

Proposed ( Yeongrim Go )<br>
Accepted

## Context

Kyverno Governance Platform의 Phase 1 Shift-Left PR 거버넌스 게이트([`GitOpsService`](file:///home/user/kyverno-dashboard/apps/backend/src/gitops/gitops.service.ts))는 개발자의 PR 매니페스트 위반을 진단하고 자동 교정하기 위해 **AWS Bedrock Converse API**([`AiAgentService`](file:///home/user/kyverno-dashboard/apps/backend/src/ai-agent/ai-agent.service.ts))와 **GitHub REST API(Octokit)**를 호출합니다.

백엔드 서버를 수평 확장(Scale-out)할 때 다음과 같은 외부 서비스 Quota(할당량) 한계에 부딪히게 됩니다:

1. **전역 단일 할당량(Global Account Quotas)의 벽**:
   - 백엔드 Pod 수를 5개, 10개로 늘려도 **AWS Bedrock(`us-east-1`)의 분당 요청 한도(RPM: 기본 50~100) 및 분당 토큰 한도(TPM)**, 그리고 **GitHub API Rate Limit(5,000 req/hr)**은 AWS 계정/토큰 단위의 단일 풀로 고정되어 있습니다.
   - 대규모 조직에서 일과 시간 또는 스프린트 마감 시점에 수십 개의 PR이 일제히 빌드되면, 백엔드 Pod들이 병렬로 Bedrock을 호출하여 즉시 **`ThrottlingException (HTTP 429)`**이 폭주합니다.
2. **동기식 재시도의 한계 (재시도 폭풍 / Retry Storm)**:
   - 클라이언트나 백엔드가 429 에러를 만나 동기식으로 즉시 재시도 루프를 돌 경우, Google SRE와 AWS 백서에서 경고하는 **'Thundering Herd' 및 연쇄 장애(Cascading Failure)**로 이어져 외부 API 접근이 장시간 전면 마비됩니다.

## Proposal(Decision)

희소 자원인 외부 LLM 및 GitHub API 호출을 안정적으로 관리하기 위해, **Redis 기반 분산 작업 큐(BullMQ)**와 **토큰 버킷(Token Bucket) 레이트 리미터**, 그리고 **Full Jitter 지수 백오프**를 도입합니다.

```
[GitHub PR Webhook]
        │
        ▼ (HTTP 202 Accepted)
┌────────────────────────────────────────────────────────┐
│               Redis-Backed BullMQ Queue                │
│     Job: { prNumber, clusterId, manifestYaml }         │
│     Rate Limiter: Max 40 jobs / 60,000 ms (RPM Cap)    │
└───────────────────────────┬────────────────────────────┘
                            │ Controlled Dispatch (Backpressure)
             ┌──────────────┴──────────────┐
             ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │ Worker Thread 1 │           │ Worker Thread 2 │
    │ (Bedrock Call)  │           │ (Bedrock Call)  │
    └────────┬────────┘           └────────┬────────┘
             │                             │
             ▼                             ▼
     AWS Bedrock API               GitHub Check Run
   (Strict <= 40 RPM)            (Update to "Success")
```

1. **BullMQ 기반 비동기 작업 큐 및 배압(Backpressure) 제어**:
   - `POST /api/v1/gitops/pr-review` 요청 수신 시, 즉시 Bedrock을 동기 호출하지 않고 작업을 큐에 Enqueue한 뒤 GitHub Check Run 상태를 `in_progress`로 변경하고 즉각 `HTTP 202 Accepted`를 반환합니다.
   - BullMQ의 내장 `limiter` 설정을 통해 Bedrock의 안전 쿼터 한계(예: 최대 40 RPM)를 전역적으로 강제합니다.
2. **토큰 버킷 알고리즘 적용**:
   - 버스트(Burst) 트래픽을 일정 수준 흡수하면서도 평균 처리량을 Bedrock RPM/TPM 허용치 이하로 평활화(Traffic Smoothing)합니다.
3. **Full Jitter 지수 백오프 (Exponential Backoff with Full Jitter)**:
   - 일시적 429 또는 503 오류 발생 시, AWS 아키텍처 권장 공식인 `Sleep = rand(0, min(cap, base * 2^attempt))`를 적용하여 재시도 스케줄을 무작위로 분산시킵니다.
4. **Dead Letter Queue (DLQ) 및 비상 폴백**:
   - 최대 재시도(3회) 초과 시 작업을 DLQ로 격리하고, PR에는 AI 자가 교정 대신 안전한 기본 가이드(Safe Guidance) 코멘트를 남기도록 처리합니다.

## Consequences

* **얻을 수 있는 이점**:
  * **외부 API 스로틀링 0건 달성**: 트래픽이 일시적으로 10배 폭증하더라도 모든 요청이 큐에 안전하게 완충되어 429 에러로 드롭되지 않습니다.
  * **비용 폭탄 및 Quota 소진 예방**: 플랫폼 전역에서 LLM 토큰 소비 속도를 통제하여 예산 초과를 방지합니다.
  * **클라우드 복원력(Resilience) 확보**: AWS Bedrock 리전 장애 시 작업 재시도 및 큐 보존을 통해 데이터 유실을 차단합니다.

* **감수해야 할 제약 사항 및 아키텍처 디펜스**:
  * **처리 지연(Latency)과 사용자 경험(UX) 방어**:
    - *질문*: PR 리뷰 결과가 큐 대기로 인해 수 초~수십 초 지연되면 개발자 경험이 나빠지지 않는가?
    - *디펜스*: GitHub Actions 및 Check Run API는 본래 비동기 폴링 모델을 전제로 설계되었습니다. 개발자는 GitHub PR 페이지에서 "Kyverno Governance Review: In Progress" 진행 상태를 보며 대기하므로, 즉각적인 실패(429 Error)를 반환받아 빌드가 깨지는 것보다 수십 초 후 무결하게 AI 교정 제안을 받는 것이 엔터프라이즈 관점에서 훨씬 뛰어난 경험입니다.

## References
* [AWS Architecture Blog: Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
* [AWS Bedrock User Guide: Quotas and Throttling Guidance](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html)
* [BullMQ Official Documentation: Rate Limiting & Concurrency](https://docs.bullmq.io/guide/rate-limiting)
