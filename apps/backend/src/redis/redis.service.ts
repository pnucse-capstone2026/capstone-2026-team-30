import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis, { RedisOptions } from "ioredis";
import { Subject } from "rxjs";

export const REDIS_CLIENTS = "REDIS_CLIENTS";

export interface InjectedRedisClients {
  publisher?: Redis;
  subscriber?: Redis;
}

export type MessageHandler = (channel: string, message: string) => void;
export type PatternMessageHandler = (
  pattern: string,
  channel: string,
  message: string,
) => void;

/**
 * Redis Pub/Sub 기반 분산 이벤트 메시 인프라 서비스
 *
 * 이중 커넥션(Publisher/Command 클라이언트 및 Subscriber 전용 클라이언트)을 관리하며,
 * Redis 연결 불가 시 애플리케이션 다운을 방지하는 인메모리 폴백(Graceful Degradation)을 제공합니다.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  private publisherClient: Redis | null = null;
  private subscriberClient: Redis | null = null;
  private isConnectedFlag = false;

  private readonly patternHandlers = new Map<
    string,
    Set<PatternMessageHandler>
  >();
  private readonly channelHandlers = new Map<string, Set<MessageHandler>>();

  // Redis 미연결 시 로컬 메모리 이벤트 전달을 위한 폴백 Subject
  private readonly fallbackSubject = new Subject<{
    channel: string;
    message: string;
  }>();

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional()
    @Inject(REDIS_CLIENTS)
    injectedClients?: InjectedRedisClients,
  ) {
    if (injectedClients?.publisher && injectedClients?.subscriber) {
      this.publisherClient = injectedClients.publisher;
      this.subscriberClient = injectedClients.subscriber;
      this.isConnectedFlag = true;
      this.bindSubscriberEvents(this.subscriberClient);
    }
  }

  /**
   * 모듈 초기화 시 Redis 연결을 수립하고 Subscriber 이벤트 리스너를 바인딩합니다.
   */
  async onModuleInit(): Promise<void> {
    if (!this.publisherClient || !this.subscriberClient) {
      this.initClients();
    }
    await this.tryConnect();
  }

  /**
   * 모듈 종료 시 모든 Redis 커넥션을 안전하게 정리합니다.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      if (this.subscriberClient) {
        this.subscriberClient.disconnect();
        this.subscriberClient = null;
      }
      if (this.publisherClient) {
        this.publisherClient.disconnect();
        this.publisherClient = null;
      }
    } catch {
      // 종료 예외 무시
    }
    this.isConnectedFlag = false;
  }

  /**
   * Redis 클라이언트 연결 상태를 반환합니다.
   */
  isConnected(): boolean {
    return this.isConnectedFlag;
  }

  /**
   * 지정된 Redis 채널로 메시지를 발행(PUBLISH)합니다.
   *
   * @param channel 대상 채널명 (예: events:incidents:cluster-alpha)
   * @param message 발행할 메시지 (JSON 직렬화된 문자열 등)
   * @returns 메시지를 수신한 구독자 수 또는 폴백 전송 성공 시 1
   */
  async publish(channel: string, message: string): Promise<number> {
    if (this.isConnectedFlag && this.publisherClient) {
      try {
        return await this.publisherClient.publish(channel, message);
      } catch (err: unknown) {
        this.logger.warn(
          `[Redis] Publish failed on channel ${channel}. Falling back to in-memory bus: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // 인메모리 폴백: 로컬 인스턴스 내 구독자들에게 즉시 디스패치
    this.dispatchLocalMessage(channel, message);
    return 1;
  }

  /**
   * 패턴 기반 Redis 채널을 구독(PSUBSCRIBE)합니다.
   *
   * @param pattern 구독 패턴 (예: events:incidents:*)
   * @param handler 메시지 수신 시 호출될 핸들러
   */
  async psubscribe(
    pattern: string,
    handler: PatternMessageHandler,
  ): Promise<void> {
    if (!this.patternHandlers.has(pattern)) {
      this.patternHandlers.set(pattern, new Set());
    }
    this.patternHandlers.get(pattern)!.add(handler);

    if (this.isConnectedFlag && this.subscriberClient) {
      try {
        await this.subscriberClient.psubscribe(pattern);
      } catch (err: unknown) {
        this.logger.warn(
          `[Redis] Failed to psubscribe to ${pattern}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * 단일 Redis 채널을 구독(SUBSCRIBE)합니다.
   *
   * @param channel 구독 대상 채널명
   * @param handler 메시지 수신 시 호출될 핸들러
   */
  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    if (!this.channelHandlers.has(channel)) {
      this.channelHandlers.set(channel, new Set());
    }
    this.channelHandlers.get(channel)!.add(handler);

    if (this.isConnectedFlag && this.subscriberClient) {
      try {
        await this.subscriberClient.subscribe(channel);
      } catch (err: unknown) {
        this.logger.warn(
          `[Redis] Failed to subscribe to ${channel}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * 환경 설정에 따라 Publisher 및 Subscriber 클라이언트를 초기화합니다.
   */
  private initClients(): void {
    const host =
      this.configService?.get<string>("REDIS_HOST") ||
      process.env.REDIS_HOST ||
      "localhost";
    const port = Number(
      this.configService?.get<number | string>("REDIS_PORT") ||
        process.env.REDIS_PORT ||
        6379,
    );
    const password =
      this.configService?.get<string>("REDIS_PASSWORD") ||
      process.env.REDIS_PASSWORD ||
      undefined;

    const isTls =
      this.configService?.get<string | boolean>("REDIS_TLS") === true ||
      this.configService?.get<string>("REDIS_TLS") === "true" ||
      process.env.REDIS_TLS === "true";

    const redisOptions: RedisOptions = {
      host,
      port,
      password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      ...(isTls ? { tls: {} } : {}),
      retryStrategy: (times: number) => Math.min(times * 500, 30000),
    };

    this.publisherClient = new Redis(redisOptions);
    this.subscriberClient = new Redis(redisOptions);

    this.bindSubscriberEvents(this.subscriberClient);
  }

  /**
   * Subscriber 클라이언트의 Redis 이벤트 핸들러를 등록합니다.
   */
  private bindSubscriberEvents(subscriber: Redis): void {
    subscriber.on(
      "pmessage",
      (pattern: string, channel: string, message: string) => {
        const handlers = this.patternHandlers.get(pattern);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(pattern, channel, message);
            } catch (err) {
              this.logger.error("Error executing pattern message handler", err);
            }
          }
        }
      },
    );

    subscriber.on("message", (channel: string, message: string) => {
      const handlers = this.channelHandlers.get(channel);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(channel, message);
          } catch (err) {
            this.logger.error("Error executing channel message handler", err);
          }
        }
      }
    });

    subscriber.on("error", (err: unknown) => {
      this.logger.debug(
        `[Redis Subscriber Notice] ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.isConnectedFlag = false;
    });

    subscriber.on("connect", () => {
      this.isConnectedFlag = true;
      this.logger.log("[Redis] Connected to Redis event mesh.");
    });

    subscriber.on("close", () => {
      this.isConnectedFlag = false;
    });
  }

  /**
   * 백그라운드에서 Redis 서버로의 비동기 연결을 시도합니다.
   */
  private async tryConnect(): Promise<void> {
    if (this.isConnectedFlag) return;
    if (!this.publisherClient || !this.subscriberClient) return;

    try {
      await Promise.all([
        this.publisherClient.connect(),
        this.subscriberClient.connect(),
      ]);
      this.isConnectedFlag = true;
      this.logger.log(
        "[Redis] Successfully established dual Redis connections.",
      );

      // 재연결 시 기존 등록된 패턴 및 채널 재구독
      for (const pattern of this.patternHandlers.keys()) {
        await this.subscriberClient.psubscribe(pattern);
      }
      for (const channel of this.channelHandlers.keys()) {
        await this.subscriberClient.subscribe(channel);
      }
    } catch (err: unknown) {
      this.isConnectedFlag = false;
      this.logger.warn(
        `[Redis] Failed to connect to Redis server: ${
          err instanceof Error ? err.message : String(err)
        }. Operating in graceful in-memory fallback mode.`,
      );
    }
  }

  /**
   * Redis 미연결 시 로컬 메모리 핸들러로 메시지를 라우팅합니다.
   */
  private dispatchLocalMessage(channel: string, message: string): void {
    // 1. 단일 채널 매칭
    const directHandlers = this.channelHandlers.get(channel);
    if (directHandlers) {
      for (const handler of directHandlers) {
        try {
          handler(channel, message);
        } catch (err) {
          this.logger.error("Error in local fallback channel handler", err);
        }
      }
    }

    // 2. 와일드카드 패턴 매칭 (예: events:incidents:* 패턴이 events:incidents:alpha에 매칭)
    for (const [pattern, handlers] of this.patternHandlers) {
      if (this.matchesPattern(pattern, channel)) {
        for (const handler of handlers) {
          try {
            handler(pattern, channel, message);
          } catch (err) {
            this.logger.error("Error in local fallback pattern handler", err);
          }
        }
      }
    }
  }

  /**
   * 간단한 Redis 와일드카드(*) 패턴 매칭 헬퍼
   */
  private matchesPattern(pattern: string, channel: string): boolean {
    if (pattern === channel) return true;
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return channel.startsWith(prefix);
    }
    return false;
  }
}
