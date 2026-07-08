import { AuthController } from './auth.controller';

describe('AuthController', () => {
  it('delegates login requests to AuthService', async () => {
    const response = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1', email: 'admin@example.com', role: 'ADMIN' },
    };
    const authService = {
      login: jest.fn().mockResolvedValue(response),
      refresh: jest.fn(),
      logout: jest.fn(),
      me: jest.fn(),
    };
    const controller = new AuthController(authService as never);
    const dto = { email: 'admin@example.com', password: 'password' };

    await expect(controller.login(dto)).resolves.toBe(response);
    expect(authService.login).toHaveBeenCalledWith(dto);
  });

  it('delegates refresh requests to AuthService', async () => {
    const response = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user: { id: 'user-1', email: 'admin@example.com', role: 'ADMIN' },
    };
    const authService = {
      login: jest.fn(),
      refresh: jest.fn().mockResolvedValue(response),
      logout: jest.fn(),
      me: jest.fn(),
    };
    const controller = new AuthController(authService as never);
    const dto = { refreshToken: 'refresh-token' };

    await expect(controller.refresh(dto)).resolves.toBe(response);
    expect(authService.refresh).toHaveBeenCalledWith(dto);
  });

  it('delegates logout requests to AuthService', async () => {
    const response = { success: true };
    const authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(response),
      me: jest.fn(),
    };
    const controller = new AuthController(authService as never);
    const dto = { refreshToken: 'refresh-token' };

    await expect(controller.logout(dto)).resolves.toBe(response);
    expect(authService.logout).toHaveBeenCalledWith(dto);
  });

  it('delegates me requests to AuthService', () => {
    const user = { id: 'user-1', email: 'admin@example.com', role: 'ADMIN' };
    const authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      me: jest.fn().mockReturnValue(user),
    };
    const controller = new AuthController(authService as never);

    expect(controller.me(user as never)).toBe(user);
    expect(authService.me).toHaveBeenCalledWith(user);
  });
});
