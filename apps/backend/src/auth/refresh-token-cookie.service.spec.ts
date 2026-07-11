import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { RefreshTokenCookieService } from './refresh-token-cookie.service';

function createService(expiresIn = '7d') {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_REFRESH_EXPIRES_IN') {
        return expiresIn;
      }

      return undefined;
    }),
  };

  return {
    service: new RefreshTokenCookieService(
      configService as unknown as ConfigService,
    ),
    configService,
  };
}

function createRequest(cookie?: string): Request {
  return {
    headers: cookie ? { cookie } : {},
  } as unknown as Request;
}

function createResponse(): Response {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

describe('RefreshTokenCookieService', () => {
  it('reads the refresh token cookie', () => {
    const { service } = createService();

    expect(
      service.get(createRequest('other=value; refresh_token=refresh%20token')),
    ).toBe('refresh token');
  });

  it('returns undefined when the refresh token cookie is missing', () => {
    const { service } = createService();

    expect(service.get(createRequest('other=value'))).toBeUndefined();
  });

  it('returns undefined when the refresh token cookie is malformed', () => {
    const { service } = createService();

    expect(service.get(createRequest('refresh_token=%E0%A4%A'))).toBeUndefined();
  });

  it('sets an HttpOnly refresh token cookie', () => {
    const { service } = createService('15m');
    const response = createResponse();

    service.set(response, 'refresh-token');

    expect(response.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/auth',
      maxAge: 15 * 60 * 1000,
    });
  });

  it('clears the refresh token cookie with matching options', () => {
    const { service } = createService();
    const response = createResponse();

    service.clear(response);

    expect(response.clearCookie).toHaveBeenCalledWith('refresh_token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/auth',
    });
  });
});
