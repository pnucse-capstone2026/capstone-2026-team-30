# 6. Redis Pub/Sub 기반 멀티 인스턴스 실시간 SSE(Server-Sent Events) 이벤트 브로드캐스팅

## Status

Proposed ( Yeongrim Go )<br>
Accepted

## Context

Kyverno Governance Platform은 정책 차단 인시던트 발생(`incident:created`, `incident:updated`) 및 세션 강제 종료(`FORCE_LOGOUT`)를 웹 대시보드에 실시간으로 전달하기 위해 **SSE(Server-Sent Events, `@Sse`)** 스트림을 제공하고 있습니다 ([`IncidentsEventsService`](file:///home/user/kyverno-dashboard/apps/backend/src/incidents/incidents-events.service.ts), [`SessionEventsService`](file:///home/user/kyverno-dashboard/apps/backend/src/auth/session-events.service.ts)).

현재 아키텍처는 단일 Node.js 프로세스의 **인메모리 RxJS `Subject`**에 의존하고 있어, 백엔드 Pod를 수평 확장(Scale-out)할 때 다음과 같은 기능적 결함이 발생합니다:

1. **인스턴스 간 이벤트 고립 및 알림 유실**:
   - 로드밸런서에 의해 유저 A는 **Pod-1**에 SSE 커넥션을 맺고 있고, 유저 B는 **Pod-2**에 맺고 있는 상태에서, Pod-2의 감시 워처가 배포 차단 인시던트를 감지할 경우 Pod-2 로컬 메모리에만 이벤트가 발행됩니다.
   - 결과적으로 Pod-1에 연결된 유저 A의 대시보드에는 인시던트 경고 배너가 전혀 노출되지 않습니다.
2. **Sticky Session의 비효율성**:
   - 웹소켓이나 SSE 연결을 특정 Pod로 고정하더라도, 이벤트를 생성하는 생산자(Producer) Pod와 소비하는 클라이언트가 연결된 Pod가 다를 수밖에 없으므로 세션 고정만으로는 이 문제를 해결할 수 없습니다.

## Proposal(Decision)

모든 백엔드 Pod 간의 실시간 이벤트 동기화를 위해 **Redis Pub/Sub**을 이벤트 버스(Distributed Event Mesh)로 도입하고, **W3C `Last-Event-ID` 표준 기반의 하이드레이션(Hydration)** 구조를 적용합니다.

```
┌────────────────────────────────────────────────────────┐
│               Redis In-Memory Event Bus                │
│         Channel: "events:incidents:cluster-alpha"      │
└───────────────▲────────────────────────┬───────────────┘
                │ PUBLISH                │ SUBSCRIBE
        ┌───────┴───────┐        ┌───────┴───────┐
        │  Backend Pod 1│        │  Backend Pod 2│
        │               │        │               │
        │ Ingest Event  │        │ Relay to SSE  │
        └───────────────┘        └───────┬───────┘
                                         │ SSE Stream
                                         ▼
                                ┌─────────────────┐
                                │  Web Browser A  │
                                │ (Admin Console) │
                                └─────────────────┘
```

1. **Redis Pub/Sub 채널 구조 설계**:
   - `events:incidents:<clusterId>`: 테넌트 및 클러스터 격리를 준수하는 세분화된 Pub/Sub 채널 구성.
   - 각 Pod는 클라이언트가 SSE 스트림(`GET /api/v1/incidents/events`)을 열 때, 유저의 인가된 클러스터 목록(`user.clusterIds`)에 해당하는 Redis 채널을 구독(`SUBSCRIBE`)합니다.
   - 인시던트가 감지되거나 갱신되면 담당 Pod가 해당 Redis 채널로 이벤트를 발행(`PUBLISH`)하여 모든 활성 Pod로 수 마이크로초 내에 팬아웃(Fan-out)합니다.
2. **W3C `Last-Event-ID` 기반 장애 복구 (Delta Hydration)**:
   - Redis Pub/Sub은 Fire-and-Forget 특성을 가지므로, 네트워크 일시 단절이나 Pod 재시작 중 발생한 이벤트를 보존하지 않습니다.
   - 클라이언트 브라우저가 자동 재연결할 때 전송하는 `Last-Event-ID` 타임스탬프를 백엔드가 수신하여, 해당 시점 이후에 발생한 `DeploymentIncident` 레코드를 PostgreSQL에서 직접 조회하여 누락분을 일괄 전송합니다.

## Consequences

* **얻을 수 있는 이점**:
  * **초저지연 글로벌 브로드캐스팅**: 디스크 쓰기 없는 인메모리 Pub/Sub을 통해 수 마이크로초~밀리초 내에 전 세계 사용자 브라우저로 알림이 도달합니다.
  * **완전한 무상태(Stateless) 아키텍처 및 선형적 스케일 아웃**: 클라이언트가 어떤 Pod에 접속하든 동일한 실시간성을 보장받으므로, ALB/Ingress 설정에서 Sticky Session을 완전히 제거하고 순수 라운드로빈 부하 분산이 가능합니다.
  * **리소스 효율성**: NestJS의 마이크로서비스 모듈 및 `ioredis` 라이브러리와 원활히 통합되어 가벼운 메모리 풋프린트를 유지합니다.

* **감수해야 할 제약 사항 및 아키텍처 디펜스**:
  * **Kafka / RabbitMQ 대비 Redis 채택 이유**:
    - *질문*: 영속성(Persistence)이 보장되는 Kafka나 RabbitMQ를 써야 하지 않는가?
    - *디펜스*: SSE 이벤트는 **"UI 실시간 갱신 신호"**일 뿐이며, 비즈니스 엔티티 자체는 이미 PostgreSQL에 완전하게 영속화되어 있습니다. Kafka의 파티셔닝 복잡도 및 브로커 클러스터 운영 비용, RabbitMQ의 AMQP 채널 오버헤드 대비 Redis는 압도적으로 가볍고 저지연이며, 이미 캐시 인프라로 널리 사용되므로 TCO(총소유비용) 관점에서 최적의 선택입니다.
  * **Redis 단일 장애점(SPOF) 방어**:
    - AWS ElastiCache for Redis (Multi-AZ with Auto-Failover) 또는 Kubernetes 내 Sentinel/Cluster 구성을 통해 고가용성을 확보합니다.

## References
* [Redis Documentation: Redis Pub/Sub Interface](https://redis.io/docs/latest/develop/interact/pubsub/)
* [W3C Recommendation: Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
* [AWS Architecture Blog: Scalable Real-time Event Architectures with Redis](https://aws.amazon.com/blogs/database/)
