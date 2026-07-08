import { Role } from '@prisma/client';

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
  jti?: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
};
