import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SystemController } from "./system.controller";
import { SystemService } from "./system.service";

/**
 * 플랫폼 역량 탐지 및 시스템 모듈
 */
@Module({
  imports: [ConfigModule],
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
