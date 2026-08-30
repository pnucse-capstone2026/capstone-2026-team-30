import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

export interface GovernanceStreamEvent {
  type: string;
  data: Record<string, unknown>;
  clusterId?: string;
  namespace?: string;
}

/**
 * MLOps 리소스 거버넌스, 유휴 감시 및 GPU 쿼터 상태 변경 이벤트를
 * 실시간 SSE 스트림으로 분배하는 이벤트 버스 서비스입니다.
 */
@Injectable()
export class MlGovernanceEventBus {
  private readonly eventSubject = new Subject<GovernanceStreamEvent>();

  /**
   * 거버넌스 관련 도메인 이벤트를 브로드캐스트합니다.
   *
   * @param type 이벤트 유형 (예: 'governance-updated', 'gpu-quota-changed', 'policy-violation-detected')
   * @param data 이벤트 페이로드
   * @param clusterId (선택) 특정 대상 클러스터 식별자
   * @param namespace (선택) 특정 대상 네임스페이스
   */
  emit(
    type: string,
    data: Record<string, unknown> = {},
    clusterId?: string,
    namespace?: string,
  ): void {
    this.eventSubject.next({
      type,
      data,
      clusterId,
      namespace,
    });
  }

  /**
   * 이벤트 스트림 Observable을 반환합니다.
   */
  asObservable(): Observable<GovernanceStreamEvent> {
    return this.eventSubject.asObservable();
  }
}
