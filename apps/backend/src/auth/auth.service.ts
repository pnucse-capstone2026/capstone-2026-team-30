import { randomUUID } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import {
  DEFAULT_ACCESS_TOKEN_EXPIRES_IN,
  DEFAULT_REFRESH_TOKEN_EXPIRES_IN,
  getExpiresAt,
} from './token-expiration';

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
  ) {}

  me(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.disabledAt) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const passwordMatches = await argon2.verify(user.pwdHash, dto.password);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const authenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
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
        throw new UnauthorizedException('Invalid credentials.');
      }

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
        throw new UnauthorizedException('Invalid refresh token.');
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
        throw new UnauthorizedException('Invalid refresh token.');
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
      const tokenRecords = await this.findMatchingRefreshTokens(
        payload.sub,
        refreshToken,
      );

      await this.revokeRefreshTokens(tokenRecords);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
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
      jti: randomUUID(),
    };

    const accessTokenExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
      DEFAULT_ACCESS_TOKEN_EXPIRES_IN;
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTokenExpiresIn as never,
    });
    const refreshTokenExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      DEFAULT_REFRESH_TOKEN_EXPIRES_IN;
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
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
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token.');
    }
  }

  private async getActiveUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        disabledAt: true,
      },
    });

    if (!user || user.disabledAt) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
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
      orderBy: { createdAt: 'desc' },
    });
    const matches: RefreshTokenRecord[] = [];

    for (const candidate of candidates) {
      if (await argon2.verify(candidate.tokenHash, refreshToken)) {
        matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    return matches;
  }

  private async revokeRefreshTokens(tokens: RefreshTokenRecord[]) {
    await this.prisma.refreshToken.updateMany({
      where: { id: { in: tokens.map((token) => token.id) } },
      data: { revokedAt: new Date() },
    });
  }

}
