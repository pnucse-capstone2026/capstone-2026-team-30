import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthGuard } from "@nestjs/passport";
import * as crypto from "crypto";
import { BusinessException } from "../../common/errors/business.exception";
import { AUTH_ERROR } from "../../auth/auth.errors";
import { GITOPS_ERROR } from "../gitops.errors";
import { AuthenticatedUser } from "../../auth/auth.types";

/**
 * CI/CD 파이프라인 및 개발자 포털을 위한 이중 인증 가드 (Dual Authentication Guard)
 *
 * ## 동작 방식 및 인증 우선순위:
 * 1. **CI 전용 API Key / Webhook Secret (`X-CI-Token` 또는 `X-API-Key`)**:
 *    - GitHub Actions, GitLab CI 등 자동화 파이프라인에서 호출할 때 사용합니다.
 *    - 환경변수 `GITOPS_CI_TOKEN` 또는 `CI_API_KEY` 값과 상수 시간 비교(timingSafeEqual)로 안전하게 대조합니다.
 *    - 인증 성공 시 `req.user`에 가상 CI 봇 사용자(`id: 'ci-bot'`, `role: 'PLATFORM_ADMIN'`, 전체 클러스터 권한)를 주입합니다.
 *
 * 2. **사용자 JWT Bearer Token (`Authorization: Bearer <token>`)**:
 *    - Kyverno Platform 웹 대시보드 또는 CLI에서 로그인한 사용자가 직접 호출할 때 사용합니다.
 *    - 기존 `JwtAuthGuard` (Passport JWT 전략)를 호출하여 토큰 서명 및 만료를 검증합니다.
 *
 * 3. **인증 실패**:
 *    - 두 인증 수단이 모두 제공되지 않거나 잘못된 경우 `AUTHENTICATION_REQUIRED` 또는 `UNAUTHORIZED_CI_TOKEN` 예외를 발생시킵니다.
 */
@Injectable()
export class CiOrJwtAuthGuard extends AuthGuard("jwt") implements CanActivate {
  private readonly logger = new Logger(CiOrJwtAuthGuard.name);
  private readonly configuredCiToken?: string;

  constructor(private readonly configService: ConfigService) {
    super();
    this.configuredCiToken =
      this.configService.get<string>("GITOPS_CI_TOKEN") ||
      this.configService.get<string>("CI_API_KEY");
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const headers = request.headers || {};
    const ciTokenHeader = headers["x-ci-token"] || headers["x-api-key"];

    // 1. CI 전용 API 토큰 검증 경로
    if (ciTokenHeader) {
      if (!this.configuredCiToken) {
        this.logger.warn(
          "CI token header provided but GITOPS_CI_TOKEN / CI_API_KEY is not configured on server.",
        );
        throw new BusinessException(GITOPS_ERROR.UNAUTHORIZED_CI_TOKEN);
      }

      const providedBuffer = Buffer.from(ciTokenHeader);
      const configuredBuffer = Buffer.from(this.configuredCiToken);

      const isValid =
        providedBuffer.length === configuredBuffer.length &&
        crypto.timingSafeEqual(providedBuffer, configuredBuffer);

      if (!isValid) {
        throw new BusinessException(GITOPS_ERROR.UNAUTHORIZED_CI_TOKEN);
      }

      // CI 시스템용 가상 사용자 컨텍스트 주입
      request.user = {
        id: "ci-bot",
        email: "ci-bot@platform.local",
        role: "ADMIN",
        clusterIds: ["*"],
      };

      return true;
    }

    // 2. JWT Bearer 토큰 검증 경로 (웹 대시보드 및 일반 사용자)
    const authHeader = headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const canPass = (await super.canActivate(context)) as boolean;
        return canPass;
      } catch (err) {
        this.logger.debug(
          `JWT authentication failed: ${(err as Error).message}`,
        );
        throw new BusinessException(AUTH_ERROR.AUTHENTICATION_REQUIRED);
      }
    }

    // 인증 헤더 부재
    throw new BusinessException(AUTH_ERROR.AUTHENTICATION_REQUIRED);
  }
}
