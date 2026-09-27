import {
  Injectable,
  Logger,
  MessageEvent,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { filter, map } from "rxjs/operators";
import { DeploymentIncidentDto } from "./dto/incident-response.dto";
import { RedisService } from "../redis/redis.service";

export interface IncidentSsePayload {
  eventType: "incident:created" | "incident:updated";
  incident: DeploymentIncidentDto;
  timestamp: string;
}

/**
 * Admission Block 배포 차단 인시던트의 실시간 SSE(Server-Sent Events) 브로드캐스트 관리 서비스입니다.
 *
 * Redis Pub/Sub 채널(`events:incidents:<clusterId>`)을 통해 멀티 인스턴스 환경에서
 * 모든 Pod로 실시간 이벤트를 전파하며, W3C Last-Event-ID 표준 식별자를 부여합니다.
 */
@Injectable()
export class IncidentsEventsService implements OnModuleInit {
  private readonly logger = new Logger(IncidentsEventsService.name);
  private readonly eventStream = new Subject<IncidentSsePayload>();

  constructor(@Optional() private readonly redisService?: RedisService) {}

  /**
   * 모듈 초기화 시 Redis의 전역 인시던트 채널 패턴을 구독합니다.
   */
  async onModuleInit(): Promise<void> {
    if (this.redisService) {
      await this.redisService.psubscribe(
        "events:incidents:*",
        (_pattern, _channel, message) => {
          try {
            const payload = JSON.parse(message) as IncidentSsePayload;
            this.eventStream.next(payload);
          } catch (err) {
            this.logger.error(
              "Failed to parse incident SSE message from Redis",
              err,
            );
          }
        },
      );
      this.logger.log(
        "[SSE] Subscribed to Redis channel pattern: events:incidents:*",
      );
    }
  }

  /**
   * 신규 인시던트 생성 이벤트를 Redis Pub/Sub 채널로 발행합니다.
   *
   * @param incident 생성된 인시던트 DTO
   */
  async emitIncidentCreated(incident: DeploymentIncidentDto): Promise<void> {
    this.logger.log(
      `[SSE] Emitting incident:created for incident ${incident.id} (cluster: ${incident.clusterId}, resource: ${incident.resourceKind}/${incident.resourceName})`,
    );
    const payload: IncidentSsePayload = {
      eventType: "incident:created",
      incident,
      timestamp: new Date().toISOString(),
    };

    if (this.redisService) {
      const channel = `events:incidents:${incident.clusterId}`;
      await this.redisService.publish(channel, JSON.stringify(payload));
    } else {
      // Redis 미주입 환경 인메모리 직접 디스패치
      this.eventStream.next(payload);
    }
  }

  /**
   * 인시던트 갱신(중복 차단 카운트 증가 또는 상태 변경) 이벤트를 Redis Pub/Sub 채널로 발행합니다.
   *
   * @param incident 갱신된 인시던트 DTO
   */
  async emitIncidentUpdated(incident: DeploymentIncidentDto): Promise<void> {
    this.logger.log(
      `[SSE] Emitting incident:updated for incident ${incident.id} (status: ${incident.status}, count: ${incident.blockCount})`,
    );
    const payload: IncidentSsePayload = {
      eventType: "incident:updated",
      incident,
      timestamp: new Date().toISOString(),
    };

    if (this.redisService) {
      const channel = `events:incidents:${incident.clusterId}`;
      await this.redisService.publish(channel, JSON.stringify(payload));
    } else {
      this.eventStream.next(payload);
    }
  }

  /**
   * 사용자가 접근 권한을 가진 클러스터의 실시간 인시던트 SSE 스트림을 구독합니다.
   *
   * @param allowedClusterIds 사용자가 접근 권한을 가진 클러스터 ID 목록
   * @param isAdmin 사용자가 ADMIN 역할인지 여부 (ADMIN인 경우 전체 클러스터 수신)
   * @returns W3C id가 부여된 SSE MessageEvent 옵저버블
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
            id: payload.incident.id,
            data: payload,
            type: payload.eventType,
          }) as MessageEvent,
      ),
    );
  }
}
