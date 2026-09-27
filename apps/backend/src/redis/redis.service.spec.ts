import { Test, TestingModule } from "@nestjs/testing";
import { REDIS_CLIENTS, RedisService } from "./redis.service";

describe("RedisService", () => {
  let service: RedisService;
  let mockPublisher: {
    publish: jest.Mock;
    disconnect: jest.Mock;
    connect: jest.Mock;
  };
  let mockSubscriber: {
    psubscribe: jest.Mock;
    subscribe: jest.Mock;
    disconnect: jest.Mock;
    connect: jest.Mock;
    on: jest.Mock;
  };
  let subscriberEventListeners: Record<string, (...args: any[]) => void> = {};

  beforeEach(async () => {
    subscriberEventListeners = {};

    mockPublisher = {
      publish: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
    };

    mockSubscriber = {
      psubscribe: jest.fn().mockResolvedValue("OK"),
      subscribe: jest.fn().mockResolvedValue("OK"),
      disconnect: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockImplementation((event, callback) => {
        subscriberEventListeners[event] = callback;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: REDIS_CLIENTS,
          useValue: {
            publisher: mockPublisher,
            subscriber: mockSubscriber,
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it("should be defined and report connected status when injected with clients", () => {
    expect(service).toBeDefined();
    expect(service.isConnected()).toBe(true);
  });

  it("publishes messages through the publisher client when connected", async () => {
    const channel = "events:incidents:cluster-alpha";
    const message = JSON.stringify({ eventType: "incident:created" });

    const result = await service.publish(channel, message);

    expect(result).toBe(1);
    expect(mockPublisher.publish).toHaveBeenCalledWith(channel, message);
  });

  it("registers psubscribe patterns and dispatches received messages", async () => {
    const pattern = "events:incidents:*";
    const handler = jest.fn();

    await service.psubscribe(pattern, handler);
    expect(mockSubscriber.psubscribe).toHaveBeenCalledWith(pattern);

    // Redis pmessage 수신 시뮬레이션
    const pmessageListener = subscriberEventListeners["pmessage"];
    expect(pmessageListener).toBeDefined();

    pmessageListener(
      pattern,
      "events:incidents:cluster-alpha",
      JSON.stringify({ id: "inc-1" }),
    );

    expect(handler).toHaveBeenCalledWith(
      pattern,
      "events:incidents:cluster-alpha",
      JSON.stringify({ id: "inc-1" }),
    );
  });

  it("falls back to in-memory dispatch when Redis is disconnected", async () => {
    // 미연결 상태의 독립 RedisService 생성
    const fallbackService = new RedisService(undefined, undefined);

    const handler = jest.fn();
    await fallbackService.psubscribe("events:incidents:*", handler);

    const channel = "events:incidents:cluster-beta";
    const message = JSON.stringify({ id: "inc-beta" });

    // 발행 시 Redis가 없으므로 로컬 인메모리 디스패치 수행
    await fallbackService.publish(channel, message);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      "events:incidents:*",
      channel,
      message,
    );

    await fallbackService.onModuleDestroy();
  });

  it("safely cleans up connections on destroy", async () => {
    await service.onModuleDestroy();
    expect(mockPublisher.disconnect).toHaveBeenCalledTimes(1);
    expect(mockSubscriber.disconnect).toHaveBeenCalledTimes(1);
  });
});
