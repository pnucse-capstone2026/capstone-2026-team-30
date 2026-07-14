import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';

const user = {
  id: 'user-1',
  email: 'admin@example.com',
  role: Role.ADMIN,
};

function createContext(requestUser: typeof user | undefined = user, hasUser = true) {
  const handler = jest.fn();
  const controllerClass = class TestController {};

  return {
    getHandler: jest.fn().mockReturnValue(handler),
    getClass: jest.fn().mockReturnValue(controllerClass),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(hasUser ? { user: requestUser } : {}),
    }),
  } as unknown as ExecutionContext;
}

function createGuard(requiredPermissions?: string[], count = 0) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredPermissions),
  };
  const prisma = {
    rolePermission: {
      count: jest.fn().mockResolvedValue(count),
    },
  };

  return {
    guard: new PermissionsGuard(
      reflector as unknown as Reflector,
      prisma as never,
    ),
    reflector,
    prisma,
  };
}

describe('PermissionsGuard', () => {
  it('allows requests when no permissions are required', async () => {
    const { guard, prisma } = createGuard(undefined);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(prisma.rolePermission.count).not.toHaveBeenCalled();
  });

  it('allows requests when the user role has every required permission', async () => {
    const { guard, prisma } = createGuard(
      ['users.read', 'users.create'],
      2,
    );

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(prisma.rolePermission.count).toHaveBeenCalledWith({
      where: {
        role: Role.ADMIN,
        permission: {
          key: { in: ['users.read', 'users.create'] },
        },
      },
    });
  });

  it('deduplicates required permissions before checking role mappings', async () => {
    const { guard, prisma } = createGuard(['users.read', 'users.read'], 1);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(prisma.rolePermission.count).toHaveBeenCalledWith({
      where: {
        role: Role.ADMIN,
        permission: {
          key: { in: ['users.read'] },
        },
      },
    });
  });

  it('rejects requests without an authenticated user', async () => {
    const { guard } = createGuard(['users.read'], 1);

    await expect(guard.canActivate(createContext(undefined, false))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects requests when the user role is missing any required permission', async () => {
    const { guard } = createGuard(['users.read', 'users.create'], 1);

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
