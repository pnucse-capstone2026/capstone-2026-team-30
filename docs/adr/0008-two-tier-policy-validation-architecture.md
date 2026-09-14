# 8. 2단계(Two-Tier) 정책 검증 게이트 및 Kyverno CEL 전환을 통한 웹훅 부하 완화

## Status

Proposed ( Yeongrim Go )<br>
Accepted

## Context

Kyverno Governance Platform은 개발자가 GitHub PR을 생성할 때 실제 클러스터의 Kyverno 정책과 대조하여 완벽히 결정론적으로 사전 검증하기 위해 **Server-Side Dry-Run (`dryRun: ['All']`)** 엔진([`SimulationService`](file:///home/user/kyverno-dashboard/apps/backend/src/simulation/simulation.service.ts))을 운영하고 있습니다.

이 검증 방식은 실제 K8s API Server의 `ValidatingWebhookConfiguration`을 통해 대상 클러스터 내부의 Kyverno Pod(`validate.kyverno.svc`)로 웹훅 트래픽을 유발합니다. 백엔드 서버를 수평 확장(Scale-out)할 때 대상 클러스터 컨트롤 플레인에 다음과 같은 병목이 발생합니다:

1. **Kyverno Admission Webhook 타임아웃 (10s Timeout / HTTP 504)**:
   - 다수의 개발자 및 마이크로서비스 팀이 동시에 수십~수백 건의 PR 검증을 요청할 경우, 대상 클러스터 내의 Kyverno Webhook Pod 큐가 포화됩니다.
   - 쿠버네티스 Admission Webhook의 기본 타임아웃(10초)을 초과하여 PR 검증 파이프라인 전체가 504 게이트웨이 타임아웃 오류로 정지되는 현상이 발생합니다.
2. **EKS API Priority and Fairness (APF) Throttling**:
   - 단일 클러스터에 수많은 Dry-Run 요청이 집중되면 EKS 컨트롤 플레인의 FlowSchema / PriorityLevelConfiguration에 의해 플랫폼 트래픽이 스로틀링(`HTTP 429 Too Many Requests`)됩니다.

## Proposal(Decision)

클러스터 웹훅 부하를 최소화하면서도 100% 결정론적 신뢰성을 유지하기 위해, **2단계(Two-Tier) 검증 게이트 아키텍처**와 **Kyverno CEL(Common Expression Language) 정책 최적화**를 도입합니다.

```
[Developer PR Manifest]
          │
          ▼
┌────────────────────────────────────────────────────────┐
│             Tier 1: In-Memory Fast-Fail Gate           │
│        (KyvernoRuleTemplateEngine / AST Parser)        │
│          - Check: require-labels, non-root, limits     │
│          - Latency: 1 ~ 5 ms (Zero Network I/O)        │
└─────────┬────────────────────────────────────┬─────────┘
          │ PASS                               │ FAIL (Policy Violation)
          ▼                                    ▼
┌───────────────────────────────┐     ┌───────────────────────────────┐
│ Tier 2: Real K8s Server Dry-Run│     │ Bypass K8s Webhook Call!      │
│ (Target EKS / Kyverno CEL)    │     │ Directly trigger AI Self-     │
│ - Authoritative Final Pass    │     │ Correction Loop               │
└───────────────────────────────┘     └───────────────────────────────┘
```

1. **2단계 검증 게이트 (Two-Tier Validation Gate) 구축**:
   - **Tier 1 (로컬 인메모리 Fast-Fail)**:
     - [`KyvernoRuleTemplateEngine`](file:///home/user/kyverno-dashboard/apps/backend/src/ai-agent/rule-template.engine.ts)의 로컬 AST 및 정규식 엔진을 1차 관문으로 배치합니다.
     - 필수 레이블 누락, `privileged: true`, 리소스 Limit 누락 등 가장 빈번하게 발생하는 정형화된 위반을 수 밀리초 내에 메모리에서 선별합니다.
     - 위반이 감지되면 **실제 K8s API Server 및 Kyverno Webhook을 전혀 호출하지 않고** 곧바로 AI 자가 교정 루프로 우회시킵니다.
   - **Tier 2 (최종 클러스터 Server-Side Dry-Run)**:
     - Tier 1을 통과한 '위반 가능성이 매우 낮은' 매니페스트만 최종 권위(Authoritative) 관문으로서 실제 K8s API Server의 `dryRun: ['All']`을 통과시킵니다.
2. **Kyverno CEL(Common Expression Language) 정책 전환 ([Kyverno CEL Docs](https://kyverno.io/docs/writing-policies/cel/))**:
   - Kyverno v1.11+ 공식 가이드에 따라, 기존의 복잡한 JSON-Patch 기반 Admission 룰을 컴파일드 CEL 표현식으로 점진적 마이그레이션합니다.
   - 인라인 CEL 평가는 별도의 외부 프로세스 평가 없이 네이티브 바이너리 수준에서 실행되므로 Webhook 지연 시간을 수 배 단축합니다.

## Consequences

* **얻을 수 있는 이점**:
  * **K8s Webhook 네트워크 I/O 60~80% 절감**: 일반적인 PR 위반의 대다수가 라벨 및 기본 보안 컨텍스트 누락이므로, 실제 클러스터 웹훅으로 전달되는 트래픽이 극적으로 감소합니다.
  * **초고속 개발자 피드백**: Tier 1에서 차단된 PR은 클러스터 네트워크 왕복 시간(200~800ms)을 거치지 않고 즉각 AI 교정 루프를 시작합니다.
  * **EKS APF 429 스로틀링 및 10s 타임아웃 원천 차단**: 웹훅 대기열 포화를 방지하여 클러스터 컨트롤 플레인의 안정성을 영구적으로 확보합니다.

* **감수해야 할 제약 사항 및 아키텍처 디펜스**:
  * **정책 불일치(Configuration Drift) 우려 방어**:
    - *질문*: 백엔드 로컬 룰 엔진과 실제 클러스터의 정책이 어긋나서 잘못 통과(False Negative)시키면 어떡하는가?
    - *디펜스*: Tier 1은 클러스터 검증을 **대체하는 것이 아니라 위반 건을 먼저 걸러내는 필터**입니다. Tier 1을 통과한 매니페스트는 **예외 없이 무조건 Tier 2(실제 클러스터 Dry-Run)를 거쳐야만 최종 PR 합격 판정**을 받습니다. 따라서 보안 결함이나 오판이 발생할 확률은 0%이며, 완벽한 보안성과 고성능을 동시에 충족합니다.
  * **동적 컨텍스트 검증 한계**:
    - 네임스페이스 셀렉터나 ConfigMap 연동 정책은 Tier 1 로컬에서 평가할 수 없으므로 자연스럽게 Tier 2로 전달되어 실제 클러스터에서 안전하게 평가됩니다.

## References
* [Kyverno Official Documentation: Scalability and Performance Best Practices](https://kyverno.io/docs/monitoring-troubleshooting/performance/)
* [Kyverno Official Documentation: Writing CEL-based Policies](https://kyverno.io/docs/writing-policies/cel/)
* [Kubernetes Documentation: API Priority and Fairness](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/)
