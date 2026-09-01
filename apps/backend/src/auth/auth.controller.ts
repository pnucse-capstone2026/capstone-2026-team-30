import {
  Body,
  Controller,
  Get,
  HttpCode,
  MessageEvent,
  Post,
  Req,
  Res,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { Observable } from "rxjs";
import { BusinessException } from "../common/errors/business.exception";
import { AUTH_ERROR } from "./auth.errors";
import { AuthenticatedUser } from "./auth.types";
import { AuthService } from "./auth.service";
import { SessionEventsService } from "./session-events.service";
import { CurrentUser } from "./decorators/current-user.decorator";
import { LoginDto } from "./dto/login.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RefreshTokenCookieService } from "./refresh-token-cookie.service";

type AuthResponseBody = {
  accessToken: string;
  user: AuthenticatedUser;
};

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionEventsService: SessionEventsService,
    private readonly refreshTokenCookieService: RefreshTokenCookieService,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseBody> {
    const result = await this.authService.login(dto);

    this.refreshTokenCookieService.set(response, result.refreshToken, request);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseBody> {
    const refreshToken = this.refreshTokenCookieService.get(request);

    if (!refreshToken) {
      throw new BusinessException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    const result = await this.authService.refresh(refreshToken);

    this.refreshTokenCookieService.set(response, result.refreshToken, request);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logout(
      this.refreshTokenCookieService.get(request),
    );

    this.refreshTokenCookieService.clear(response, request);

    return result;
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user);
  }

  @Sse("session-events")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "실시간 세션 상태 SSE 스트림",
    description:
      "다른 기기에서의 중복 로그인 감지 시 FORCE_LOGOUT 이벤트를 실시간으로 전달합니다.",
  })
  sessionEvents(
    @CurrentUser() user: AuthenticatedUser,
  ): Observable<MessageEvent> {
    return this.sessionEventsService.subscribe(user.id);
  }
}
