import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';

const payload = {
  sub: 'user-1',
  email: 'admin@example.com',
  role: Role.ADMIN,
};

function createStrategy() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('access-secret'),
  };

  return {
    strategy: new JwtStrategy(
      prisma as never,
      configService as unknown as ConfigService,
    ),
    prisma,
    configService,
  };
}

describe('JwtStrategy', () => {
  it('uses JWT_ACCESS_SECRET', () => {
    const { configService } = createStrategy();

    expect(configService.getOrThrow).toHaveBeenCalledWith('JWT_ACCESS_SECRET');
  });

  it('validates an active user from the payload subject', async () => {
    const { strategy, prisma } = createStrategy();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: Role.ADMIN,
      disabledAt: null,
    });

    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'user-1',
      email: 'admin@example.com',
      role: Role.ADMIN,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        email: true,
        role: true,
        disabledAt: true,
      },
    });
  });

  it('rejects a missing user', async () => {
    const { strategy, prisma } = createStrategy();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a disabled user', async () => {
    const { strategy, prisma } = createStrategy();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.com',
      role: Role.ADMIN,
      disabledAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
