import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import type { Socket } from "net";
import type { JwtPayload } from "../../auth/auth.types";

/**
 * 프로비저닝된 Kubeflow Notebook으로의 HTTP 웹 트래픽 및 WebSocket 연결을
 * Kubernetes 내부 클러스터 네트워크로 안전하게 중계하는 인앱 리버스 프록시 서비스입니다.
 */
@Injectable()
export class NotebookProxyService
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(NotebookProxyService.name);
  private proxy!: RequestHandler;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 모듈 초기화 시 동적 K8s 서비스 라우터 및 WebSocket을 지원하는 프록시 인스턴스를 생성합니다.
   */
  onModuleInit(): void {
    this.proxy = createProxyMiddleware({
      router: (req) => {
        const url = (req as any).originalUrl || req.url || "";
        const match = url.match(/^\/notebook\/([^/?#]+)\/([^/?#]+)/);
        if (match) {
          const [, namespace, name] = match;
          return `http://${name}.${namespace}.svc.cluster.local:80`;
        }
        return undefined;
      },
      changeOrigin: true,
      ws: true,
      on: {
        proxyRes: (proxyRes, req) => {
          const token = (req as any).__notebook_token;
          if (token) {
            const url = (req as any).originalUrl || req.url || "";
            const match = url.match(/^\/notebook\/([^/?#]+)\/([^/?#]+)/);
            if (match) {
              const [, namespace, name] = match;
              const cookieVal = `notebook_token=${encodeURIComponent(token)}; Path=/notebook/${namespace}/${name}; HttpOnly; SameSite=Lax; Max-Age=28800`;
              const existing = proxyRes.headers["set-cookie"];
              if (existing) {
                proxyRes.headers["set-cookie"] = Array.isArray(existing)
                  ? [...existing, cookieVal]
                  : [existing, cookieVal];
              } else {
                proxyRes.headers["set-cookie"] = [cookieVal];
              }
            }
          }
        },
        error: (err, _req, res) => {
          this.logger.error(`Notebook proxy error: ${err.message}`);
          if (
            res &&
            "writeHead" in res &&
            typeof (res as ServerResponse).writeHead === "function" &&
            !(res as ServerResponse).headersSent
          ) {
            (res as ServerResponse).writeHead(502, {
              "Content-Type": "text/html; charset=utf-8",
            });
            (res as ServerResponse).end(
              this.renderErrorHtml(
                "502 Bad Gateway - 노트북 워크스페이스 연결 실패",
                "지정한 노트북 인스턴스가 아직 기동 중이거나 중지 상태일 수 있습니다. 대시보드에서 상태를 확인한 후 다시 시도해 주세요.",
              ),
            );
          } else if (
            res &&
            "destroy" in res &&
            typeof (res as Socket).destroy === "function"
          ) {
            (res as Socket).destroy();
          }
        },
      },
    });
  }

  /**
   * 애플리케이션 부트스트랩 완료 시 Jupyter 커널 양방향 통신을 위한 WebSocket Upgrade 리스너를 바인딩합니다.
   */
  onApplicationBootstrap(): void {
    const httpAdapter = this.adapterHost.httpAdapter;
    const server = httpAdapter.getHttpServer();

    server.on(
      "upgrade",
      async (req: IncomingMessage, socket: Socket, head: Buffer) => {
        if (!req.url?.startsWith("/notebook")) {
          return;
        }

        const token = this.extractToken(req);
        if (!token) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        const payload = await this.validateToken(token);
        if (!payload) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        (this.proxy as any).upgrade(req, socket, head);
      },
    );

    this.logger.log(
      "Notebook WebSocket upgrade listener registered successfully.",
    );
  }

  /**
   * HTTP 프록시 요청을 수신하여 인증을 검증하고 K8s 서비스로 중계합니다.
   *
   * @param req Express 요청 객체
   * @param res Express 응답 객체
   * @param next 다음 미들웨어 함수
   */
  async handleHttp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const url = req.originalUrl || req.url || "";
    const match = url.match(/^\/notebook\/([^/?#]+)\/([^/?#]+)/);
    if (!match) {
      res
        .status(404)
        .send(
          "올바르지 않은 노트북 경로입니다. (형식: /notebook/:namespace/:name)",
        );
      return;
    }
    const [, namespace, name] = match;

    const token = this.extractToken(req);
    if (!token) {
      res
        .status(401)
        .send(
          this.renderErrorHtml(
            "401 Unauthorized - 인증 필요",
            "노트북 워크스페이스에 접속하기 위해 유효한 플랫폼 인증 토큰이 필요합니다. 대시보드에서 다시 접속해 주세요.",
          ),
        );
      return;
    }

    const payload = await this.validateToken(token);
    if (!payload) {
      res
        .status(401)
        .send(
          this.renderErrorHtml(
            "401 Unauthorized - 토큰 만료",
            "인증 세션이 만료되었습니다. 대시보드에서 재로그인 후 다시 접속해 주세요.",
          ),
        );
      return;
    }

    // 쿼리 파라미터로 최초 진입한 경우 후속 정적 에셋 및 WebSocket 연결을 위한 쿠키 발급
    const urlObj = new URL(url, "http://localhost");
    if (
      urlObj.searchParams.has("token") ||
      urlObj.searchParams.has("access_token")
    ) {
      (req as any).__notebook_token = token;
      res.setHeader(
        "Set-Cookie",
        `notebook_token=${encodeURIComponent(token)}; Path=/notebook/${namespace}/${name}; HttpOnly; SameSite=Lax; Max-Age=28800`,
      );
    }

    // Jupyter가 자신의 base_url(/notebook/:namespace/:name)을 올바르게 인식하도록 원본 URL 복원
    if (req.originalUrl) {
      req.url = req.originalUrl;
    }

    return (this.proxy as any)(req, res, next);
  }

  /**
   * HTTP 수신 요청(쿼리 파라미터, 쿠키, Authorization 헤더)에서 JWT 토큰을 추출합니다.
   *
   * @param req 수신된 HTTP 요청 객체
   * @returns 추출된 JWT 문자열 또는 null
   */
  extractToken(req: IncomingMessage): string | null {
    // 1. URL 쿼리 파라미터 확인 (?token=... or ?access_token=...)
    if (req.url) {
      try {
        const urlObj = new URL(req.url, "http://localhost");
        const queryToken =
          urlObj.searchParams.get("token") ||
          urlObj.searchParams.get("access_token");
        if (queryToken) return queryToken;
      } catch {
        // URL 파싱 에러 무시
      }
    }

    // 2. Cookie 헤더 확인 (notebook_token=...)
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)notebook_token=([^;]+)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
    }

    // 3. Authorization Bearer 헤더 확인
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7).trim();
    }

    return null;
  }

  /**
   * JWT 토큰의 서명 및 데이터베이스 내 사용자 유효성을 검증합니다.
   *
   * @param token 검증 대상 JWT 토큰
   * @returns 인증 성공 시 JwtPayload, 실패 시 null
   */
  async validateToken(token: string): Promise<JwtPayload | null> {
    try {
      const secret = this.configService.getOrThrow<string>("JWT_ACCESS_SECRET");
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, disabledAt: true, currentSessionId: true },
      });

      if (!user || user.disabledAt) {
        return null;
      }

      // 동시 접속 세션 검증
      if (
        payload.sessionId &&
        user.currentSessionId &&
        user.currentSessionId !== payload.sessionId
      ) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * 브라우저 사용자에게 표시할 안내용 에러 HTML을 생성합니다.
   */
  private renderErrorHtml(title: string, message: string): string {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
    .card { background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); max-width: 480px; text-align: center; border: 1px solid #e2e8f0; }
    h2 { margin-top: 0; color: #1e293b; font-size: 1.25rem; font-weight: 600; }
    p { color: #64748b; font-size: 0.875rem; line-height: 1.6; margin-bottom: 1.5rem; }
    a { display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 0.5rem 1.25rem; border-radius: 6px; font-size: 0.875rem; font-weight: 500; }
    a:hover { background: #4338ca; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${title}</h2>
    <p>${message}</p>
    <a href="/" target="_self">대시보드로 돌아가기</a>
  </div>
</body>
</html>`;
  }
}
