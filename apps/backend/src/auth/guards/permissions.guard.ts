import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service";
import { PermissionKey } from "../../seed/rbac-seed.service";
import { AuthenticatedUser } from "../auth.types";
import { REQUIRED_PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      PermissionKey[]
    >(REQUIRED_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;

    if (!user) {
      throw new UnauthorizedException();
    }

    const uniquePermissions = [...new Set(requiredPermissions)];
    const matchingPermissionCount = await this.prisma.rolePermission.count({
      where: {
        role: user.role,
        permission: {
          key: { in: uniquePermissions },
        },
      },
    });

    if (matchingPermissionCount !== uniquePermissions.length) {
      throw new ForbiddenException("Insufficient permissions.");
    }

    return true;
  }
}
