import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
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
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  return {
    service: new UsersService(prisma as never),
    prisma,
  };
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
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(user);
    jest.spyOn(argon2, 'hash').mockResolvedValue('hashed-password');

    await expect(
      service.create({
        email: ' Requester@Example.com ',
        password: 'plain-password',
        role: Role.REQUESTER,
      }),
    ).resolves.toEqual(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'requester@example.com' },
      select: { id: true },
    });
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
    prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.create({
        email: user.email,
        password: 'plain-password',
        role: Role.REQUESTER,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('updates a user role', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: user.id });
    prisma.user.update.mockResolvedValue({ ...user, role: Role.APPROVER });

    await expect(
      service.updateRole(user.id, { role: Role.APPROVER }),
    ).resolves.toEqual({ ...user, role: Role.APPROVER });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { role: Role.APPROVER },
      select: expect.any(Object),
    });
  });

  it('resets a user password', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: user.id });
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
  });

  it('sets disabledAt when disabling a user', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: user.id });
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
  });

  it('clears disabledAt when enabling a user', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: user.id });
    prisma.user.update.mockResolvedValue(user);

    await expect(
      service.setDisabled(user.id, { disabled: false }),
    ).resolves.toEqual(user);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { disabledAt: null },
      select: expect.any(Object),
    });
  });

  it('rejects updates for missing users', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.updateRole('missing-user', { role: Role.VIEWER }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
