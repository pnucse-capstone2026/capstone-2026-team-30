import { Injectable, Logger, MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { filter, map } from "rxjs/operators";
import { DeploymentIncidentDto } from "./dto/incident-response.dto";

export interface IncidentSsePayload {
  eventType: "incident:created" | "incident:updated";
  incident: DeploymentIncidentDto;
  timestamp: string;
}

/**
 * Admission Block 배포 차단 인시던트의 실시간 SSE(Server-Sent Events) 브로드캐스트 관리 서비스입니다.
 */
@Injectable()
export class IncidentsEventsService {
  private readonly logger = new Logger(IncidentsEventsService.name);
  private readonly eventStream = new Subject<IncidentSsePayload>();

  /**
   * 신규 인시던트 생성 이벤트를 브로드캐스트합니다.
   *
   * @param incident 생성된 인시던트 DTO
   */
  emitIncidentCreated(incident: DeploymentIncidentDto): void {
    this.logger.log(
      `[SSE] Emitting incident:created for incident ${incident.id} (cluster: ${incident.clusterId}, resource: ${incident.resourceKind}/${incident.resourceName})`,
    );
    this.eventStream.next({
      eventType: "incident:created",
      incident,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 인시던트 갱신(중복 차단 카운트 증가 또는 상태 변경) 이벤트를 브로드캐스트합니다.
   *
   * @param incident 갱신된 인시던트 DTO
   */
  emitIncidentUpdated(incident: DeploymentIncidentDto): void {
    this.logger.log(
      `[SSE] Emitting incident:updated for incident ${incident.id} (status: ${incident.status}, count: ${incident.blockCount})`,
    );
    this.eventStream.next({
      eventType: "incident:updated",
      incident,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 사용자가 접근 권한을 가진 클러스터의 실시간 인시던트 SSE 스트림을 구독합니다.
   *
   * @param allowedClusterIds 사용자가 접근 권한을 가진 클러스터 ID 목록
   * @param isAdmin 사용자가 ADMIN 역할인지 여부 (ADMIN인 경우 전체 클러스터 수신)
   * @returns SSE MessageEvent 옵저버블
   */
  subscribe(
    allowedClusterIds: string[],
    isAdmin = false,
  ): Observable<MessageEvent> {
    const clusterSet = new Set(allowedClusterIds);

    return this.eventStream.pipe(
      filter(
        (payload) => isAdmin || clusterSet.has(payload.incident.clusterId),
      ),
      map(
        (payload) =>
          ({
            data: payload,
            type: payload.eventType,
          }) as MessageEvent,
      ),
    );
  }
}
