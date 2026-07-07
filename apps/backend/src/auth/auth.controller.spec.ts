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
    };
    const controller = new AuthController(authService as never);
    const dto = { email: 'admin@example.com', password: 'password' };

    await expect(controller.login(dto)).resolves.toBe(response);
    expect(authService.login).toHaveBeenCalledWith(dto);
  });
});
