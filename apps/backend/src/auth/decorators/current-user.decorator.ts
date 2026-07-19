import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedUser } from "../auth.types";

export function getCurrentUserFromRequest(
  _data: unknown,
  ctx: ExecutionContext,
): AuthenticatedUser {
  return ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user;
}

export const CurrentUser = createParamDecorator(getCurrentUserFromRequest);
