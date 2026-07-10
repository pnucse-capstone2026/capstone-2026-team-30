import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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

const publicUser = {
  id: activeUser.id,
  email: activeUser.email,
  role: activeUser.role,
};

function createService() {
  const prisma = {
    runSerializableTransaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: 'refresh-token-2' }),
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.runSerializableTransaction.mockImplementation(
    async (
      operation: (transaction: typeof prisma) => Promise<unknown>,
    ): Promise<unknown> => operation(prisma),
  );
  const jwtService = {
    signAsync: jest
      .fn()
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token'),
    verifyAsync: jest.fn().mockResolvedValue({
      sub: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
    }),
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

  it('returns the authenticated user for me', () => {
    const { service } = createService();

    expect(service.me(publicUser)).toBe(publicUser);
  });

  it('logs in with valid credentials and stores only a refresh token hash', async () => {
    const { service, prisma, jwtService } = createService();
    const nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    prisma.user.findUnique.mockResolvedValue(activeUser);
    jest.spyOn(argon2, 'verify').mockResolvedValue(true);
    jest.spyOn(argon2, 'hash').mockResolvedValue('refresh-token-hash');
    jest.spyOn(Date, 'now').mockReturnValue(nowMs);

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
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
      },
    });
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: publicUser,
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

  it('rejects a disabled user during login', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      disabledAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await expect(
      service.login({ email: activeUser.email, password: 'plain-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refreshes tokens with rotation', async () => {
    const { service, prisma, jwtService } = createService();
    jwtService.signAsync
      .mockReset()
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');
    prisma.user.findUnique.mockResolvedValue({
      id: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
      disabledAt: null,
    });
    prisma.refreshToken.findMany.mockResolvedValue([
      { id: 'refresh-token-1', tokenHash: 'stored-refresh-token-hash' },
    ]);
    jest.spyOn(argon2, 'verify').mockResolvedValue(true);
    jest.spyOn(argon2, 'hash').mockResolvedValue('new-refresh-token-hash');

    const result = await service.refresh('old-refresh-token');

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('old-refresh-token', {
      secret: 'refresh-secret',
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['refresh-token-1'] },
        userId: activeUser.id,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: {
        tokenHash: 'new-refresh-token-hash',
        userId: activeUser.id,
        expiresAt: expect.any(Date),
      },
    });
    expect(prisma.runSerializableTransaction).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: publicUser,
    });
  });

  it('rejects refresh when another request has already claimed the token', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
      disabledAt: null,
    });
    prisma.refreshToken.findMany.mockResolvedValue([
      { id: 'refresh-token-1', tokenHash: 'stored-refresh-token-hash' },
    ]);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    jest.spyOn(argon2, 'verify').mockResolvedValue(true);
    jest.spyOn(argon2, 'hash').mockResolvedValue('new-refresh-token-hash');

    await expect(
      service.refresh('old-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects a reused, revoked, or expired refresh token', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
      disabledAt: null,
    });
    prisma.refreshToken.findMany.mockResolvedValue([]);

    await expect(
      service.refresh('old-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token for a missing user', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.refresh('old-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token for a disabled user', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      id: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
      disabledAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await expect(
      service.refresh('old-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logs out by revoking the matching refresh token', async () => {
    const { service, prisma } = createService();
    prisma.refreshToken.findMany.mockResolvedValue([
      { id: 'refresh-token-1', tokenHash: 'stored-refresh-token-hash' },
    ]);
    jest.spyOn(argon2, 'verify').mockResolvedValue(true);

    await expect(
      service.logout('old-refresh-token'),
    ).resolves.toEqual({ success: true });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['refresh-token-1'] } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('treats unknown refresh tokens as successful logout', async () => {
    const { service, prisma } = createService();
    prisma.refreshToken.findMany.mockResolvedValue([]);

    await expect(
      service.logout('unknown-refresh-token'),
    ).resolves.toEqual({ success: true });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('treats invalid refresh token signatures as successful logout', async () => {
    const { service, prisma, jwtService } = createService();
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(service.logout('invalid-refresh-token')).resolves.toEqual({
      success: true,
    });
    expect(prisma.refreshToken.findMany).not.toHaveBeenCalled();
  });

  it('does not hide persistence failures during logout', async () => {
    const { service, prisma } = createService();
    const databaseError = new Error('database unavailable');
    prisma.refreshToken.findMany.mockRejectedValue(databaseError);

    await expect(service.logout('old-refresh-token')).rejects.toBe(
      databaseError,
    );
  });
});
