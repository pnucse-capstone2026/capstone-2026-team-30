import { Request, Response } from "express";
import { AuthController } from "./auth.controller";
import { AUTH_ERROR } from "./auth.errors";

function createResponse(): Response {
  return {} as Response;
}

function createRequest(): Request {
  return {} as Request;
}

function createAuthService(overrides = {}) {
  return {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    me: jest.fn(),
    ...overrides,
  };
}

function createRefreshTokenCookieService(overrides = {}) {
  return {
    get: jest.fn(),
    set: jest.fn(),
    clear: jest.fn(),
    ...overrides,
  };
}

describe("AuthController", () => {
  it("delegates login requests and stores refresh tokens in a cookie", async () => {
    const response = createResponse();
    const serviceResponse = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: { id: "user-1", email: "admin@example.com", role: "ADMIN" },
    };
    const authService = createAuthService({
      login: jest.fn().mockResolvedValue(serviceResponse),
    });
    const refreshTokenCookieService = createRefreshTokenCookieService();
    const controller = new AuthController(
      authService as never,
      refreshTokenCookieService as never,
    );
    const dto = { email: "admin@example.com", password: "password" };

    await expect(controller.login(dto, response)).resolves.toEqual({
      accessToken: "access-token",
      user: serviceResponse.user,
    });
    expect(authService.login).toHaveBeenCalledWith(dto);
    expect(refreshTokenCookieService.set).toHaveBeenCalledWith(
      response,
      "refresh-token",
    );
  });

  it("refreshes tokens from the refresh token cookie", async () => {
    const request = createRequest();
    const response = createResponse();
    const serviceResponse = {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      user: { id: "user-1", email: "admin@example.com", role: "ADMIN" },
    };
    const authService = createAuthService({
      refresh: jest.fn().mockResolvedValue(serviceResponse),
    });
    const refreshTokenCookieService = createRefreshTokenCookieService({
      get: jest.fn().mockReturnValue("old-refresh-token"),
    });
    const controller = new AuthController(
      authService as never,
      refreshTokenCookieService as never,
    );

    await expect(controller.refresh(request, response)).resolves.toEqual({
      accessToken: "new-access-token",
      user: serviceResponse.user,
    });
    expect(refreshTokenCookieService.get).toHaveBeenCalledWith(request);
    expect(authService.refresh).toHaveBeenCalledWith("old-refresh-token");
    expect(refreshTokenCookieService.set).toHaveBeenCalledWith(
      response,
      "new-refresh-token",
    );
  });

  it("rejects refresh requests without a refresh token cookie", async () => {
    const authService = createAuthService();
    const refreshTokenCookieService = createRefreshTokenCookieService({
      get: jest.fn().mockReturnValue(undefined),
    });
    const controller = new AuthController(
      authService as never,
      refreshTokenCookieService as never,
    );

    await expect(
      controller.refresh(createRequest(), createResponse()),
    ).rejects.toMatchObject({
      code: AUTH_ERROR.INVALID_REFRESH_TOKEN.code,
    });
    expect(authService.refresh).not.toHaveBeenCalled();
  });

  it("logs out by revoking the refresh token cookie value and clearing the cookie", async () => {
    const request = createRequest();
    const response = createResponse();
    const serviceResponse = { success: true };
    const authService = createAuthService({
      logout: jest.fn().mockResolvedValue(serviceResponse),
    });
    const refreshTokenCookieService = createRefreshTokenCookieService({
      get: jest.fn().mockReturnValue("old-refresh-token"),
    });
    const controller = new AuthController(
      authService as never,
      refreshTokenCookieService as never,
    );

    await expect(controller.logout(request, response)).resolves.toBe(
      serviceResponse,
    );
    expect(authService.logout).toHaveBeenCalledWith("old-refresh-token");
    expect(refreshTokenCookieService.clear).toHaveBeenCalledWith(response);
  });

  it("delegates me requests to AuthService", () => {
    const user = { id: "user-1", email: "admin@example.com", role: "ADMIN" };
    const authService = createAuthService({
      me: jest.fn().mockReturnValue(user),
    });
    const controller = new AuthController(
      authService as never,
      createRefreshTokenCookieService() as never,
    );

    expect(controller.me(user as never)).toBe(user);
    expect(authService.me).toHaveBeenCalledWith(user);
  });
});
