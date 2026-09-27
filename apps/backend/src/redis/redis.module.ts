import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";

/**
 * 전역 Redis Pub/Sub 이벤트 메시 인프라 모듈
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
