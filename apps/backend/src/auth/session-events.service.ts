import { Injectable, Logger, MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { filter, map } from "rxjs/operators";

export interface SessionEvent {
  userId: string;
  type: "FORCE_LOGOUT" | "SESSION_ACTIVE";
  message: string;
  timestamp: string;
}

/**
 * 실시간 세션 상태 및 중복 로그인 강제 로그아웃(Kick-out) SSE 이벤트를 관리하는 서비스입니다.
 */
@Injectable()
export class SessionEventsService {
  private readonly logger = new Logger(SessionEventsService.name);
  private readonly eventStream = new Subject<SessionEvent>();

  /**
   * 특정 사용자에게 강제 로그아웃 이벤트를 브로드캐스트합니다.
   *
   * @param userId 대상 사용자 ID
   * @param message 사용자 화면에 표시할 안내 메시지
   */
  emitForceLogout(
    userId: string,
    message = "다른 기기 또는 브라우저에서 새로 로그인하여 현재 접속이 종료되었습니다.",
  ): void {
    this.logger.log(`Emitting FORCE_LOGOUT for user ${userId}`);
    this.eventStream.next({
      userId,
      type: "FORCE_LOGOUT",
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 특정 사용자의 실시간 세션 SSE 스트림을 구독합니다.
   *
   * @param userId 구독할 사용자 ID
   */
  subscribe(userId: string): Observable<MessageEvent> {
    return this.eventStream.pipe(
      filter((event) => event.userId === userId),
      map(
        (event) =>
          ({
            data: event,
          }) as MessageEvent,
      ),
    );
  }
}
