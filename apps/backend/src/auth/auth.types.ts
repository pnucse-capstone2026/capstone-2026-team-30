import { Role } from "@prisma/client";

export type JwtPayload = {
  sub: string;
  email: string;
  role: Role;
  jti?: string;
  sessionId?: string;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
  sessionId?: string;
  /** 역할과 무관하게 접근이 허용된 클러스터. */
  clusterIds: string[];
};
