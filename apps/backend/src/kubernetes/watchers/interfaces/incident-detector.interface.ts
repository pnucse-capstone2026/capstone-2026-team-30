import { KubeConfig } from "@kubernetes/client-node";

/**
 * Kyverno Admission Webhook에 의해 차단된 리소스 및 파이프라인 인시던트 표준 이벤트 인터페이스
 */
export interface AdmissionIncidentEvent {
  clusterId: string;
  namespace: string;
  resourceKind: string;
  resourceName: string;
  policyName: string;
  ruleName?: string;
  blockReason: string;
  gitopsAppName?: string;
  gitCommitSha?: string;
  gitRepository?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 인시던트 감지 소스 콜백 핸들러 타입
 */
export type IncidentHandler = (event: AdmissionIncidentEvent) => Promise<void>;

/**
 * 배포 차단 및 인시던트 감지기 추상화 인터페이스 (SPI)
 *
 * K8s Core Event, ArgoCD Application, Flux CD, Webhook Audit Log 등
 * 다양한 감지 소스를 플러그인 형태로 확장/분리할 수 있도록 규정합니다.
 */
export interface IncidentDetector {
  /** 감지기 고유 명칭 (예: 'KubernetesCoreEvent', 'ArgoCD', 'FluxCD') */
  readonly source: string;

  /**
   * 대상 클러스터에 대해 감시자를 시작합니다.
   *
   * @param clusterId 클러스터 고유 식별자
   * @param kubeConfig 쿠버네티스 접근 설정
   * @param onIncident 차단 이벤트 발생 시 호출할 공통 인시던트 핸들러
   */
  start(
    clusterId: string,
    kubeConfig: KubeConfig,
    onIncident: IncidentHandler,
  ): Promise<void>;

  /**
   * 특정 클러스터 또는 전체에 대한 감시자를 중단하고 리소스를 해제합니다.
   *
   * @param clusterId 선택적 클러스터 식별자 (생략 시 전체)
   */
  stop(clusterId?: string): Promise<void>;
}
