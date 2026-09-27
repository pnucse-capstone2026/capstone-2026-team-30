import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { BusinessException } from "../../common/errors/business.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { AUTH_ERROR } from "../auth.errors";
import { AuthenticatedUser, JwtPayload } from "../auth.types";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => {
          if (req?.query?.token && typeof req.query.token === "string") {
            return req.query.token;
          }
          if (
            req?.query?.access_token &&
            typeof req.query.access_token === "string"
          ) {
            return req.query.access_token;
          }
          return null;
        },
      ]),
      secretOrKey: configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        currentSessionId: true,
        disabledAt: true,
        userClusters: { select: { clusterId: true } },
      },
    });

    if (!user || user.disabledAt) {
      throw new BusinessException(AUTH_ERROR.AUTHENTICATION_REQUIRED);
    }

    // 동시접속 차단(방안 A): 발급된 세션 ID와 DB의 최신 세션 ID가 불일치하면 세션 만료 에러
    if (
      payload.sessionId &&
      user.currentSessionId &&
      user.currentSessionId !== payload.sessionId
    ) {
      throw new BusinessException(AUTH_ERROR.SESSION_EXPIRED);
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: user.currentSessionId ?? undefined,
      clusterIds: user.userClusters.map((assignment) => assignment.clusterId),
    };
  }
}
