import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

const activeUser = {
  id: 'user-1',
  email: 'admin@example.com',
  pwdHash: 'stored-password-hash',
  role: Role.ADMIN,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  disabledAt: null,
};

function createService() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: 'refresh-token-1' }),
    },
  };
  const jwtService = {
    signAsync: jest
      .fn()
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token'),
  };
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };

      return values[key];
    }),
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
      };

      return values[key];
    }),
  };

  return {
    service: new AuthService(
      prisma as never,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    ),
    prisma,
    jwtService,
    configService,
  };
}

describe('AuthService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs in with valid credentials and stores only a refresh token hash', async () => {
    const { service, prisma, jwtService } = createService();
    prisma.user.findUnique.mockResolvedValue(activeUser);
    jest.spyOn(argon2, 'verify').mockResolvedValue(true);
    jest.spyOn(argon2, 'hash').mockResolvedValue('refresh-token-hash');

    const result = await service.login({
      email: ' Admin@Example.com ',
      password: 'plain-password',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
    });
    expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: {
        tokenHash: 'refresh-token-hash',
        userId: activeUser.id,
        expiresAt: expect.any(Date),
      },
    });
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: activeUser.id,
        email: activeUser.email,
        role: activeUser.role,
      },
    });
    expect(result.user).not.toHaveProperty('pwdHash');
  });

  it('rejects an unknown email', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ email: 'missing@example.com', password: 'password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid password', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(activeUser);
    jest.spyOn(argon2, 'verify').mockResolvedValue(false);

    await expect(
      service.login({ email: activeUser.email, password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a disabled user', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      disabledAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await expect(
      service.login({ email: activeUser.email, password: 'plain-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
