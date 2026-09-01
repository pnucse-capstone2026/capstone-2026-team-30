import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import {
  DEFAULT_REFRESH_TOKEN_EXPIRES_IN,
  parseExpiresInMs,
} from "./token-expiration";

const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";

@Injectable()
export class RefreshTokenCookieService {
  constructor(private readonly configService: ConfigService) {}

  get(request: Request): string | undefined {
    const cookieHeader = request.headers.cookie;

    if (!cookieHeader) {
      return undefined;
    }

    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
    const refreshTokenCookie = cookies.find((cookie) =>
      cookie.startsWith(REFRESH_TOKEN_COOKIE_NAME + "="),
    );

    if (!refreshTokenCookie) {
      return undefined;
    }

    try {
      return decodeURIComponent(
        refreshTokenCookie.slice(REFRESH_TOKEN_COOKIE_NAME.length + 1),
      );
    } catch {
      return undefined;
    }
  }

  set(response: Response, refreshToken: string, request?: Request) {
    const isSecure = this.isSecureConnection(request);
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      path: "/api/auth",
      maxAge: this.getMaxAgeMs(),
    });
  }

  clear(response: Response, request?: Request) {
    const isSecure = this.isSecureConnection(request);
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure,
      path: "/api/auth",
    });
  }

  private isSecureConnection(request?: Request): boolean {
    const configSecure = this.configService.get<string>("COOKIE_SECURE");
    if (configSecure === "true") return true;
    if (configSecure === "false") return false;

    // HTTP ALB/프록시 환경에서 비암호화 쿠키 유실 방지
    if (request) {
      const proto = request.headers["x-forwarded-proto"];
      return proto === "https" || request.secure === true;
    }

    return false;
  }

  private getMaxAgeMs(): number {
    const expiresIn =
      this.configService.get<string>("JWT_REFRESH_EXPIRES_IN") ??
      DEFAULT_REFRESH_TOKEN_EXPIRES_IN;

    return parseExpiresInMs(expiresIn);
  }
}
