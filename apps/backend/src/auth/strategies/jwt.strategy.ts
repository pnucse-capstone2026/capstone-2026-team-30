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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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
        disabledAt: true,
        userClusters: { select: { clusterId: true } },
      },
    });

    if (!user || user.disabledAt) {
      throw new BusinessException(AUTH_ERROR.AUTHENTICATION_REQUIRED);
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      clusterIds: user.userClusters.map((assignment) => assignment.clusterId),
    };
  }
}
