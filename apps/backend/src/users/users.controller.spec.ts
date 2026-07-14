import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { UsersController } from './users.controller';

function createService() {
  return {
    list: jest.fn(),
    create: jest.fn(),
    updateRole: jest.fn(),
    resetPassword: jest.fn(),
    setDisabled: jest.fn(),
  };
}

describe('UsersController', () => {
  it('protects every route with JWT and permission guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UsersController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it('declares required permissions for each admin endpoint', () => {
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, UsersController.prototype.list),
    ).toEqual(['users.read']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, UsersController.prototype.create),
    ).toEqual(['users.create']);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        UsersController.prototype.updateRole,
      ),
    ).toEqual(['users.update_role']);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        UsersController.prototype.resetPassword,
      ),
    ).toEqual(['users.reset_password']);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        UsersController.prototype.setDisabled,
      ),
    ).toEqual(['users.disable']);
  });

  it('delegates list requests to UsersService', async () => {
    const users = [{ id: 'user-1', email: 'admin@example.com', role: Role.ADMIN }];
    const service = createService();
    service.list.mockResolvedValue(users);
    const controller = new UsersController(service as never);

    await expect(controller.list()).resolves.toBe(users);
    expect(service.list).toHaveBeenCalled();
  });

  it('delegates create requests to UsersService', async () => {
    const dto = {
      email: 'requester@example.com',
      password: 'plain-password',
      role: Role.REQUESTER,
    };
    const createdUser = { id: 'user-1', email: dto.email, role: dto.role };
    const service = createService();
    service.create.mockResolvedValue(createdUser);
    const controller = new UsersController(service as never);

    await expect(controller.create(dto)).resolves.toBe(createdUser);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('delegates role updates to UsersService', async () => {
    const dto = { role: Role.APPROVER };
    const updatedUser = { id: 'user-1', email: 'user@example.com', role: dto.role };
    const service = createService();
    service.updateRole.mockResolvedValue(updatedUser);
    const controller = new UsersController(service as never);

    await expect(controller.updateRole('user-1', dto)).resolves.toBe(updatedUser);
    expect(service.updateRole).toHaveBeenCalledWith('user-1', dto);
  });

  it('delegates password resets to UsersService', async () => {
    const dto = { password: 'new-password' };
    const updatedUser = { id: 'user-1', email: 'user@example.com', role: Role.VIEWER };
    const service = createService();
    service.resetPassword.mockResolvedValue(updatedUser);
    const controller = new UsersController(service as never);

    await expect(controller.resetPassword('user-1', dto)).resolves.toBe(updatedUser);
    expect(service.resetPassword).toHaveBeenCalledWith('user-1', dto);
  });

  it('delegates disabled state updates to UsersService', async () => {
    const dto = { disabled: true };
    const updatedUser = { id: 'user-1', email: 'user@example.com', role: Role.VIEWER };
    const service = createService();
    service.setDisabled.mockResolvedValue(updatedUser);
    const controller = new UsersController(service as never);

    await expect(controller.setDisabled('user-1', dto)).resolves.toBe(updatedUser);
    expect(service.setDisabled).toHaveBeenCalledWith('user-1', dto);
  });
});
