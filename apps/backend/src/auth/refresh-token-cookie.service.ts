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

  set(response: Response, refreshToken: string) {
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth",
      maxAge: this.getMaxAgeMs(),
    });
  }

  clear(response: Response) {
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth",
    });
  }

  private getMaxAgeMs(): number {
    const expiresIn =
      this.configService.get<string>("JWT_REFRESH_EXPIRES_IN") ??
      DEFAULT_REFRESH_TOKEN_EXPIRES_IN;

    return parseExpiresInMs(expiresIn);
  }
}
