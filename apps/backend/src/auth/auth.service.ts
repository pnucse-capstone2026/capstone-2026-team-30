import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import argon2 from "argon2";
import {
  BusinessException,
  isBusinessException,
} from "../common/errors/business.exception";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_ERROR } from "./auth.errors";
import { AuthenticatedUser, JwtPayload } from "./auth.types";
import { LoginDto } from "./dto/login.dto";
import { revokeAllRefreshTokensForUser } from "./refresh-token-revocation";
import {
  DEFAULT_ACCESS_TOKEN_EXPIRES_IN,
  DEFAULT_REFRESH_TOKEN_EXPIRES_IN,
  getExpiresAt,
} from "./token-expiration";

import { SessionEventsService } from "./session-events.service";

type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
};

type LogoutResult = {
  success: true;
};

type RefreshTokenRecord = {
  id: string;
  tokenHash: string;
};

type PreparedTokenPair = {
  result: LoginResult;
  refreshTokenData: {
    tokenHash: string;
    expiresAt: Date;
  };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionEventsService: SessionEventsService,
  ) {}

  me(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { userClusters: { select: { clusterId: true } } },
    });

    if (!user || user.disabledAt) {
      throw new BusinessException(AUTH_ERROR.INVALID_CREDENTIALS);
    }

    const passwordMatches = await argon2.verify(user.pwdHash, dto.password);

    if (!passwordMatches) {
      throw new BusinessException(AUTH_ERROR.INVALID_CREDENTIALS);
    }

    // 신규 고유 세션 ID 생성 (후입 우선 원칙에 따라 기존 세션 무효화용)
    const newSessionId = randomUUID();

    // 기존 연결된 브라우저/클라이언트에 실시간 강제 로그아웃 SSE 이벤트 전송 (방안 C)
    this.sessionEventsService.emitForceLogout(user.id);

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: newSessionId,
      clusterIds: user.userClusters.map((assignment) => assignment.clusterId),
    };
    const preparedTokens = await this.prepareTokenPair(authenticatedUser);

    await this.prisma.runSerializableTransaction(async (transaction) => {
      const currentUser = await transaction.user.findUnique({
        where: { id: user.id },
        select: { pwdHash: true, disabledAt: true },
      });

      if (
        !currentUser ||
        currentUser.disabledAt ||
        currentUser.pwdHash !== user.pwdHash
      ) {
        throw new BusinessException(AUTH_ERROR.INVALID_CREDENTIALS);
      }

      // 1. 기존 모든 RefreshToken 즉시 폐기
      await revokeAllRefreshTokensForUser(transaction, user.id);

      // 2. User 테이블의 currentSessionId를 새 세션 ID로 갱신 (방안 A)
      await transaction.user.update({
        where: { id: user.id },
        data: { currentSessionId: newSessionId },
      });

      // 3. 신규 세션의 RefreshToken 등록
      await transaction.refreshToken.create({
        data: {
          ...preparedTokens.refreshTokenData,
          userId: authenticatedUser.id,
        },
      });
    });

    return preparedTokens.result;
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const user = await this.getActiveUser(payload.sub);
    const tokenRecords = await this.findMatchingRefreshTokens(
      user.id,
      refreshToken,
    );
    const preparedTokens = await this.prepareTokenPair(user);

    await this.prisma.runSerializableTransaction(async (transaction) => {
      const currentUser = await transaction.user.findUnique({
        where: { id: user.id },
        select: { disabledAt: true },
      });

      if (!currentUser || currentUser.disabledAt) {
        throw new BusinessException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
      }

      const revokedAt = new Date();
      const revokedTokens = await transaction.refreshToken.updateMany({
        where: {
          id: { in: tokenRecords.map((token) => token.id) },
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: revokedAt },
        },
        data: { revokedAt },
      });

      if (revokedTokens.count !== tokenRecords.length) {
        throw new BusinessException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
      }

      await transaction.refreshToken.create({
        data: {
          ...preparedTokens.refreshTokenData,
          userId: user.id,
        },
      });
    });

    return preparedTokens.result;
  }

  async logout(refreshToken?: string): Promise<LogoutResult> {
    try {
      if (!refreshToken) {
        return { success: true };
      }

      const payload = await this.verifyRefreshToken(refreshToken);
      await this.prisma.runSerializableTransaction((transaction) =>
        revokeAllRefreshTokensForUser(transaction, payload.sub),
      );
    } catch (error) {
      if (!isBusinessException(error, AUTH_ERROR.INVALID_REFRESH_TOKEN.code)) {
        throw error;
      }

      // Invalid tokens are intentionally treated as successful logout.
    }

    return { success: true };
  }

  private async prepareTokenPair(
    user: AuthenticatedUser,
  ): Promise<PreparedTokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId: user.sessionId,
      jti: randomUUID(),
    };

    const accessTokenExpiresIn =
      this.configService.get<string>("JWT_ACCESS_EXPIRES_IN") ??
      DEFAULT_ACCESS_TOKEN_EXPIRES_IN;
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
      expiresIn: accessTokenExpiresIn as never,
    });
    const refreshTokenExpiresIn =
      this.configService.get<string>("JWT_REFRESH_EXPIRES_IN") ??
      DEFAULT_REFRESH_TOKEN_EXPIRES_IN;
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
      expiresIn: refreshTokenExpiresIn as never,
    });
    const tokenHash = await argon2.hash(refreshToken);

    return {
      result: {
        accessToken,
        refreshToken,
        user,
      },
      refreshTokenData: {
        tokenHash,
        expiresAt: getExpiresAt(refreshTokenExpiresIn),
      },
    };
  }

  private async verifyRefreshToken(refreshToken: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
    } catch (error) {
      throw new BusinessException(AUTH_ERROR.INVALID_REFRESH_TOKEN, {
        cause: error,
      });
    }
  }

  private async getActiveUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        currentSessionId: true,
        disabledAt: true,
        userClusters: { select: { clusterId: true } },
      },
    });

    if (!user || user.disabledAt) {
      throw new BusinessException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: user.currentSessionId ?? undefined,
      clusterIds: user.userClusters.map((assignment) => assignment.clusterId),
    };
  }

  private async findMatchingRefreshTokens(
    userId: string,
    refreshToken: string,
  ): Promise<RefreshTokenRecord[]> {
    const candidates = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        tokenHash: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const matches: RefreshTokenRecord[] = [];

    for (const candidate of candidates) {
      if (await argon2.verify(candidate.tokenHash, refreshToken)) {
        matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      throw new BusinessException(AUTH_ERROR.INVALID_REFRESH_TOKEN);
    }

    return matches;
  }
}
