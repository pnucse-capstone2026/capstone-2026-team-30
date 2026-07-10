import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { UsersService } from './users.service';

const user = {
  id: 'user-1',
  email: 'requester@example.com',
  role: Role.REQUESTER,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  disabledAt: null,
};

function createService() {
  const prisma = {
    runSerializableTransaction: jest.fn(),
    user: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.runSerializableTransaction.mockImplementation(
    async (
      operation: (transaction: typeof prisma) => Promise<unknown>,
    ): Promise<unknown> => operation(prisma),
  );

  return {
    service: new UsersService(prisma as never),
    prisma,
  };
}

function createPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Prisma request failed.', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe('UsersService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists users without password hashes', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([user]);

    await expect(service.list()).resolves.toEqual([user]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        disabledAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('creates a user with normalized email and hashed password', async () => {
    const { service, prisma } = createService();
    prisma.user.create.mockResolvedValue(user);
    jest.spyOn(argon2, 'hash').mockResolvedValue('hashed-password');

    await expect(
      service.create({
        email: ' Requester@Example.com ',
        password: 'plain-password',
        role: Role.REQUESTER,
      }),
    ).resolves.toEqual(user);
    expect(argon2.hash).toHaveBeenCalledWith('plain-password');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'requester@example.com',
        pwdHash: 'hashed-password',
        role: Role.REQUESTER,
      },
      select: expect.any(Object),
    });
  });

  it('rejects duplicate user emails', async () => {
    const { service, prisma } = createService();
    prisma.user.create.mockRejectedValue(createPrismaError('P2002'));
    jest.spyOn(argon2, 'hash').mockResolvedValue('hashed-password');

    await expect(
      service.create({
        email: user.email,
        password: 'plain-password',
        role: Role.REQUESTER,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  it('updates a user role', async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockResolvedValue({ ...user, role: Role.APPROVER });

    await expect(
      service.updateRole(user.id, { role: Role.APPROVER }),
    ).resolves.toEqual({ ...user, role: Role.APPROVER });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { role: Role.APPROVER },
      select: expect.any(Object),
    });
    expect(prisma.runSerializableTransaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('resets a user password', async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockResolvedValue(user);
    jest.spyOn(argon2, 'hash').mockResolvedValue('new-hash');

    await expect(
      service.resetPassword(user.id, { password: 'new-password' }),
    ).resolves.toEqual(user);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { pwdHash: 'new-hash' },
      select: expect.any(Object),
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.runSerializableTransaction).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it('sets disabledAt when disabling a user', async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockResolvedValue({
      ...user,
      disabledAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await expect(
      service.setDisabled(user.id, { disabled: true }),
    ).resolves.toEqual({
      ...user,
      disabledAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { disabledAt: expect.any(Date) },
      select: expect.any(Object),
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.runSerializableTransaction).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it('clears disabledAt when enabling a user', async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockResolvedValue(user);

    await expect(
      service.setDisabled(user.id, { disabled: false }),
    ).resolves.toEqual(user);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { disabledAt: null },
      select: expect.any(Object),
    });
    expect(prisma.runSerializableTransaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects updates for missing users', async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockRejectedValue(createPrismaError('P2025'));

    await expect(
      service.updateRole('missing-user', { role: Role.VIEWER }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('does not hide unexpected persistence errors', async () => {
    const { service, prisma } = createService();
    const databaseError = new Error('database unavailable');
    prisma.user.update.mockRejectedValue(databaseError);

    await expect(
      service.updateRole(user.id, { role: Role.VIEWER }),
    ).rejects.toBe(databaseError);
  });
});
