import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RefreshTokenCookieService } from "./refresh-token-cookie.service";
import { PermissionsGuard } from "./guards/permissions.guard";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SessionEventsService } from "./session-events.service";

@Module({
  imports: [JwtModule.register({}), PassportModule, PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    RefreshTokenCookieService,
    PermissionsGuard,
    SessionEventsService,
  ],
  exports: [AuthService, SessionEventsService],
})
export class AuthModule {}
