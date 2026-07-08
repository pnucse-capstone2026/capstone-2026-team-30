import { randomUUID } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, JwtPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';

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

    return this.issueTokens({
      id: user.id,
      email: user.email,
      role: user.role,
    });
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const user = await this.getActiveUser(payload.sub);
    const tokenRecords = await this.findMatchingRefreshTokens(
      user.id,
      refreshToken,
    );

    await this.revokeRefreshTokens(tokenRecords);

    return this.issueTokens(user);
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
    } catch {
      // Logout is intentionally idempotent and does not reveal token validity.
    }

    return { success: true };
  }

  private async issueTokens(user: AuthenticatedUser): Promise<LoginResult> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: randomUUID(),
    };

    const accessTokenExpiresIn =
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTokenExpiresIn as never,
    });
    const refreshTokenExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshTokenExpiresIn as never,
    });
    const tokenHash = await argon2.hash(refreshToken);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: this.getExpiresAt(refreshTokenExpiresIn),
      },
    });

    return {
      accessToken,
      refreshToken,
      user,
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

  private getExpiresAt(expiresIn: string): Date {
    return new Date(Date.now() + this.parseExpiresIn(expiresIn));
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = /^(\d+)([smhd])$/.exec(expiresIn.trim());

    if (!match) {
      return 7 * 24 * 60 * 60 * 1000;
    }

    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit];
  }
}
