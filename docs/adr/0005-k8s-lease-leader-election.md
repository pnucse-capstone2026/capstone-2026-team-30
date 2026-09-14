# 5. Kubernetes Lease API 기반의 Informer 워처 리더 선출(Leader Election) 구조

## Status

Proposed ( Yeongrim Go )<br>
Accepted

## Context

Kyverno Governance Platform 백엔드는 클러스터 내의 Kyverno Admission Webhook 차단 이벤트 및 ArgoCD 애플리케이션 동기화 상태를 실시간 감지하기 위해 [`AdmissionIncidentWatcherService`](file:///home/user/kyverno-dashboard/apps/backend/src/kubernetes/watchers/admission-incident-watcher.service.ts) 및 [`K8sInformerService`](file:///home/user/kyverno-dashboard/apps/backend/src/kubernetes/k8s-informer.service.ts)를 구동하고 있습니다.

고가용성(HA) 및 부하 분산을 위해 백엔드 애플리케이션을 수평 확장(Scale-out, $N$ Pods)할 때 다음과 같은 구조적 병목과 정합성 문제가 발생합니다:

1. **K8s API Server 부하 $N$배 증폭**:
   - 모든 백엔드 Pod가 동일 클러스터에 대해 독립적인 Informer(HTTP Chunked Watch 스트림)를 연결하므로, EKS API Server의 커넥션과 CPU 리소스 소비가 $N$배로 낭비됩니다.
2. **동일 이벤트 중복 수신 및 DB Row Lock 경합**:
   - 단일 차단 인시던트 발생 시 $N$개의 Pod가 동시에 동일 이벤트를 수신하여 PostgreSQL의 [`recordAdmissionBlock`](file:///home/user/kyverno-dashboard/apps/backend/src/incidents/incidents.service.ts)을 동시 호출합니다.
   - 이로 인해 `DeploymentIncident` 테이블의 동일 행(Row)에 대한 트랜잭션 락 경합, 데드락(Deadlock) 또는 중복 삽입 레이스 컨디션이 발생합니다.

이를 해결하기 위해 멀티 인스턴스 중 단 1개의 인스턴스만 활성 워처(Active Watcher) 역할을 수행하도록 보장하는 분산 리더 선출 메커니즘이 필요합니다.

## Proposal(Decision)

Kubernetes 네이티브 분산 조율 리소스인 **`coordination.k8s.io/v1` Lease API**를 활용한 **Leader Election 패턴**을 도입합니다.

```
┌────────────────────────────────────────────────────────┐
│                   Kubernetes API Server                │
│       Lease Object: "kyverno-incident-watcher-lease"    │
│       holderIdentity: "backend-pod-1" (Renew: 2s)      │
└───────────────────────────┬────────────────────────────┘
                            │ Heartbeat (Renew)
             ┌──────────────┴──────────────┐
             ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │  Backend Pod 1  │           │  Backend Pod 2  │
    │  [ROLE: LEADER] │           │ [ROLE: STANDBY] │
    │                 │           │                 │
    │  K8s Informer   │           │  Informer Idle  │
    │  Active Watch   │           │  (Watching Lease│
    │  DB Write       │           │   for Failover) │
    └─────────────────┘           └─────────────────┘
```

1. **Kubernetes Lease 객체 기반 분산 락 구현**:
   - `coordination.k8s.io/v1` API의 `Lease` 리소스를 분산 락(Distributed Lock)의 토대로 활용합니다.
   - 각 Pod는 시작 시 자신의 고유 식별자(`HOSTNAME` 또는 Pod Name)를 `holderIdentity`로 등록하기 위해 원자적 쓰기(Atomic CAS)를 시도합니다.
2. **리더 Pod만 Watcher/Informer 가동**:
   - 리더십을 획득한 1개의 Pod만 `AdmissionIncidentWatcherService`의 `makeInformer` 스트림을 시작하고 DB 영속화 작업을 수행합니다.
   - 스탠바이 Pod들은 Watcher를 유휴(Idle) 상태로 유지하고 Lease 객체의 `renewTime`만 주기적으로 폴링합니다.
3. **자동 장애 조치 (Failover Heartbeat)**:
   - 리더 Pod는 `renewInterval`(2초)마다 임대를 갱신하며, 노드 장애 또는 프로세스 다운으로 인해 `leaseDurationSeconds`(15초) 동안 갱신이 누락되면 스탠바이 Pod가 즉시 리더십을 승계합니다.

## Consequences

* **얻을 수 있는 이점**:
  * **외부 인프라 의존성 완전 배제**: 별도의 분산 코디네이터를 도입하지 않고, Kubernetes 자체 etcd 합의 엔진을 활용하여 인프라 복잡도를 제로(0)로 유지합니다.
  * **DB Lock 경합 및 API Server 부하 원천 차단**: 클러스터당 단 1개의 스트림만 유지되므로, Pod 수가 10개, 20개로 확장되어도 DB 쓰기 충돌과 K8s 감시 트래픽이 $O(1)$로 완벽히 고정됩니다.
  * **검증된 K8s Control Plane 표준**: `kube-controller-manager` 및 `kube-scheduler`가 사용하는 동일한 공식 표준 메커니즘을 준수합니다.

* **감수해야 할 제약 사항 및 아키텍처 디펜스**:
  * **페일오버 지연 시간 (10~15초)**:
    - *리스크*: 리더 Pod 비정상 종료 시 Lease 만료까지 일시적으로 이벤트 감시가 중단될 수 있습니다.
    - *디펜스*: K8s Informer는 새 리더가 승계할 때 `ResourceVersion` 기반의 `List` 후 `Watch`를 재수행하므로, 15초 동안 발생한 ArgoCD 상태 변경 및 K8s Event는 새 리더에 의해 누락 없이 완벽히 수집(Eventual Consistency)됩니다.
  * **RBAC 권한 추가**:
    - 백엔드 ServiceAccount에 `coordination.k8s.io` API 그룹의 `leases` 리소스에 대한 `get`, `create`, `update` 권한 부여가 필요합니다.

## Alternatives Considered (대안 검토: Redis 분산 락과의 심층 비교)

ADR 0006(SSE 이벤트 브로드캐스팅) 및 ADR 0007(BullMQ 작업 큐)에서 이미 Redis가 도입되므로, 기술 스택을 단순화하기 위해 **"리더 선출까지 Redis 분산 락(Redlock)으로 일원화하는 방안"**을 면밀히 검토하였습니다. 

그럼에도 불구하고 Redis 대신 **Kubernetes Lease API를 최종 채택한 기술적 근거**는 다음과 같습니다:

### 1. CAP 정리와 일관성 보장 (Correctness vs. Efficiency)
* *참조*: 분산 시스템 석학 마틴 클레프만(Martin Kleppmann)의 분석문 [*"How to do distributed locking"*](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
* **Redis의 태생적 한계 (AP 성향 & 비동기 복제)**:
  - Redis(Sentinel, Cluster, AWS ElastiCache)는 성능을 위해 비동기 복제(Asynchronous Replication)를 사용합니다.
  - 마스터 노드가 백엔드 Pod-1에게 락을 발급한 직후 슬레이브로 복제되기 전에 마스터 장애/네트워크 파티션이 발생하면, 승격된 새 슬레이브는 락의 존재를 모른 채 Pod-2에게 락을 이중 발급합니다.
  - 이로 인해 **2개의 리더가 동시에 활성화되는 스플릿 브레인(Split-Brain)**이 발생하여 PostgreSQL 동일 행(Row)에 대한 동시 쓰기 충돌을 막지 못합니다.
* **K8s Lease(etcd)의 강한 일관성 (CP 시스템 & Raft 합의)**:
  - Lease API 뒷단의 `etcd`는 **Raft Consensus 알고리즘**을 사용하는 엄격한 CP 시스템으로, Linearizable Read/Write를 보장하여 단 하나의 리더만 존재하도록 수학적으로 보장합니다.

### 2. 장애 도메인 격리와 운명 공유 방지 (Failure Domain & Fate Sharing)
* *참조*: Google SRE Book - *Addressing Cascading Failures*
* **운명 공유(Fate Sharing) 문제**:
  - 만약 Redis로 리더 선출을 조율할 경우, BullMQ 작업 큐 폭주, Redis 메모리 부족(OOM), ElastiCache 네트워크 장애 발생 시 **Kubernetes 클러스터는 정상임에도 백엔드의 K8s 정책 감시/인시던트 수집 워처가 전면 중단**되는 외부 결합도가 발생합니다.
* **장애 격리성 확보**:
  - K8s Lease를 사용하면 Redis 인프라가 완전히 다운되더라도, **K8s 정책 감시 및 DB 영속화는 K8s API Server와 etcd만으로 100% 독립적이고 안정적으로 가동**됩니다.

### 3. Fencing Token 부재와 좀비 리더 (Zombie Leader) 방어
* Node.js 환경에서 GC Pause나 대규모 JSON 파싱으로 이벤트 루프가 멈췄을 때:
  - **Redis 락**: TTL 만료로 새 리더(Pod-2)가 승격된 후, 멈췄던 Pod-1이 깨어나 자기가 여전히 리더인 줄 알고 DB 쓰기를 시도(Zombie Leader). Redis 락은 단조 증가하는 펜싱 토큰(Fencing Token) 검증을 네이티브로 제공하지 못함.
  - **K8s Lease**: API Server가 `resourceVersion`을 통한 낙관적 동시성 제어(OCC)를 수행하므로, 좀비 리더의 갱신 시도가 `409 Conflict`로 즉각 차단됨.

### 기술 스택 비교 요약

| 비교 항목 | Redis 기반 분산 락 (Redlock) | Kubernetes Lease API (`coordination.k8s.io`) |
| :--- | :--- | :--- |
| **합의 알고리즘** | 비동기 복제 기반 (일시적 스플릿 브레인 위험) | **Raft Consensus 기반** (엄격한 상호 배제 보장) |
| **장애 격리성** | 캐시/큐 장애 시 코어 K8s 감시까지 연쇄 중단 | **외부 캐시와 완전히 격리** (K8s 내장 생명주기 공유) |
| **좀비 리더 방어**| 펜싱 토큰 미지원 (추가 Lua/애플리케이션 검증 필요) | **`resourceVersion` 기반 OCC로 자동 차단** |
| **적합한 도메인** | **데이터 플레인 (고속 I/O, SSE 알림, 작업 큐)** | **컨트롤 플레인 (무결성이 필수적인 단일 리더 조율)** |

## References
* [Kubernetes Documentation: Lease API v1 Reference](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/lease-v1/)
* [Kubernetes Documentation: Coordinated Leader Election](https://kubernetes.io/docs/concepts/architecture/leases/)
* [Go client-go: tools/leaderelection Package](https://pkg.go.dev/k8s.io/client-go/tools/leaderelection)
* [Martin Kleppmann: How to do distributed locking (Redlock Analysis)](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
* [Redis Documentation: Distributed Locks with Redis](https://redis.io/docs/latest/develop/use-cases/distributed-locks/)
