import { Test, TestingModule } from "@nestjs/testing";
import { HttpAdapterHost } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { NotebookProxyService } from "./notebook-proxy.service";
import type { IncomingMessage } from "http";

jest.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: jest
    .fn()
    .mockReturnValue(Object.assign(jest.fn(), { upgrade: jest.fn() })),
}));

describe("NotebookProxyService", () => {
  let service: NotebookProxyService;
  let jwtService: jest.Mocked<Partial<JwtService>>;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let expressApp: { use: jest.Mock };
  let httpServer: { on: jest.Mock };

  beforeEach(async () => {
    expressApp = { use: jest.fn() };
    httpServer = { on: jest.fn() };

    jwtService = {
      verifyAsync: jest.fn(),
    };

    prisma = {
      user: {
        findUnique: jest.fn(),
      } as any,
    };

    configService = {
      getOrThrow: jest.fn().mockReturnValue("test-secret"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotebookProxyService,
        {
          provide: HttpAdapterHost,
          useValue: {
            httpAdapter: {
              getInstance: () => expressApp,
              getHttpServer: () => httpServer,
            },
          },
        },
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<NotebookProxyService>(NotebookProxyService);
  });

  describe("extractToken", () => {
    it("should extract token from URL query parameter 'token'", () => {
      const req = {
        url: "/notebook/default/test-notebook/lab?token=my-jwt-token",
        headers: {},
      } as IncomingMessage;

      expect(service.extractToken(req)).toBe("my-jwt-token");
    });

    it("should extract token from URL query parameter 'access_token'", () => {
      const req = {
        url: "/notebook/default/test-notebook/lab?access_token=access-token-val",
        headers: {},
      } as IncomingMessage;

      expect(service.extractToken(req)).toBe("access-token-val");
    });

    it("should extract token from cookie header 'notebook_token'", () => {
      const req = {
        url: "/notebook/default/test-notebook/static/style.css",
        headers: {
          cookie: "foo=bar; notebook_token=cookie-jwt-token; other=baz",
        },
      } as IncomingMessage;

      expect(service.extractToken(req)).toBe("cookie-jwt-token");
    });

    it("should extract token from Authorization Bearer header", () => {
      const req = {
        url: "/notebook/default/test-notebook/api/status",
        headers: {
          authorization: "Bearer header-jwt-token",
        },
      } as IncomingMessage;

      expect(service.extractToken(req)).toBe("header-jwt-token");
    });

    it("should return null if no token is found in request", () => {
      const req = {
        url: "/notebook/default/test-notebook/lab",
        headers: {},
      } as IncomingMessage;

      expect(service.extractToken(req)).toBeNull();
    });
  });

  describe("validateToken", () => {
    it("should return payload when token is valid and user is active", async () => {
      const mockPayload = {
        sub: "user-1",
        email: "admin@test.com",
        role: "ADMIN" as const,
        sessionId: "sess-1",
      };
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(mockPayload);
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: "user-1",
        disabledAt: null,
        currentSessionId: "sess-1",
      });

      const result = await service.validateToken("valid-token");
      expect(result).toEqual(mockPayload);
    });

    it("should return null when token verification fails", async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(
        new Error("jwt expired"),
      );

      const result = await service.validateToken("expired-token");
      expect(result).toBeNull();
    });

    it("should return null when user is disabled", async () => {
      const mockPayload = {
        sub: "user-2",
        email: "disabled@test.com",
        role: "USER" as const,
      };
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(mockPayload);
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: "user-2",
        disabledAt: new Date(),
        currentSessionId: null,
      });

      const result = await service.validateToken("disabled-user-token");
      expect(result).toBeNull();
    });

    it("should return null when sessionId does not match currentSessionId", async () => {
      const mockPayload = {
        sub: "user-3",
        email: "user@test.com",
        role: "USER" as const,
        sessionId: "old-session",
      };
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(mockPayload);
      (prisma.user!.findUnique as jest.Mock).mockResolvedValue({
        id: "user-3",
        disabledAt: null,
        currentSessionId: "new-session",
      });

      const result = await service.validateToken("mismatched-session-token");
      expect(result).toBeNull();
    });
  });

  describe("onApplicationBootstrap", () => {
    it("should register upgrade listener on http server", () => {
      service.onApplicationBootstrap();

      expect(httpServer.on).toHaveBeenCalledWith(
        "upgrade",
        expect.any(Function),
      );
    });
  });

  describe("handleHttp", () => {
    it("should return 404 for invalid notebook path", async () => {
      const req = { originalUrl: "/notebook" } as any;
      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as any;
      const next = jest.fn();

      await service.handleHttp(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("should return 401 when no token is present", async () => {
      const req = {
        originalUrl: "/notebook/default/my-nb/lab",
        headers: {},
      } as any;
      const res = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as any;
      const next = jest.fn();

      await service.handleHttp(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
