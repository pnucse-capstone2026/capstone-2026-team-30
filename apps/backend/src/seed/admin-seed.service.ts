import { Role } from "@prisma/client";
import argon2 from "argon2";

export type ExistingUser = {
  id: string;
  email: string;
  role: Role;
};

export type AdminSeedPrisma = {
  user: {
    findUnique(args: {
      where: { email: string };
    }): Promise<ExistingUser | null>;
    create(args: {
      data: { email: string; pwdHash: string; role: Role };
    }): Promise<ExistingUser>;
    update?(args: {
      where: { id: string };
      data: { pwdHash: string; role?: Role };
    }): Promise<ExistingUser>;
  };
};

export type AdminSeedConfig = {
  email?: string;
  password?: string;
  role?: Role;
  forceResetPassword?: boolean;
};

export type AdminSeedResult = {
  created: boolean;
  updated?: boolean;
  user: ExistingUser;
};

/**
 * 지정된 이메일과 비밀번호로 관리자/사용자 계정을 데이터베이스에 시드(Seed)하거나 비밀번호를 고정 재설정합니다.
 *
 * @param prisma Prisma user 연동 모델
 * @param config 계정 시드 설정 (email, password, role, forceResetPassword)
 * @param hashPassword 비밀번호 해시 함수 (기본값: argon2.hash)
 * @returns 생성/업데이트 결과 및 사용자 객체
 */
export async function seedAdminUser(
  prisma: AdminSeedPrisma,
  config: AdminSeedConfig = {},
  hashPassword: (password: string) => Promise<string> = argon2.hash,
): Promise<AdminSeedResult> {
  const email = (config.email || "admin@test.com").trim().toLowerCase();
  const password = config.password || "test1234!";
  const role = config.role || Role.ADMIN;
  const forceResetPassword = config.forceResetPassword ?? true;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  const pwdHash = await hashPassword(password);

  if (existingUser) {
    if (forceResetPassword && prisma.user.update) {
      const updatedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: { pwdHash, role },
      });
      return { created: false, updated: true, user: updatedUser };
    }
    return { created: false, updated: false, user: existingUser };
  }

  const user = await prisma.user.create({
    data: {
      email,
      pwdHash,
      role,
    },
  });

  return { created: true, updated: false, user };
}

/**
 * 일반 사용자(user@test.com / test1234!) 시드 계정을 생성 또는 고정 설정합니다.
 */
export async function seedUserAccount(
  prisma: AdminSeedPrisma,
  config: AdminSeedConfig = {},
  hashPassword: (password: string) => Promise<string> = argon2.hash,
): Promise<AdminSeedResult> {
  return seedAdminUser(
    prisma,
    {
      email: config.email || "user@test.com",
      password: config.password || "test1234!",
      role: config.role || Role.REQUESTER,
      forceResetPassword: config.forceResetPassword ?? true,
    },
    hashPassword,
  );
}

/**
 * admin@test.com 및 user@test.com 표준 테스트 계정 2개를 모두 고정 시드 처리합니다.
 */
export async function seedDefaultAccounts(
  prisma: AdminSeedPrisma,
  config: {
    adminEmail?: string;
    adminPassword?: string;
    userEmail?: string;
    userPassword?: string;
  } = {},
  hashPassword: (password: string) => Promise<string> = argon2.hash,
): Promise<{ admin: AdminSeedResult; user: AdminSeedResult }> {
  const admin = await seedAdminUser(
    prisma,
    {
      email: config.adminEmail || "admin@test.com",
      password: config.adminPassword || "test1234!",
      role: Role.ADMIN,
    },
    hashPassword,
  );

  const user = await seedUserAccount(
    prisma,
    {
      email: config.userEmail || "user@test.com",
      password: config.userPassword || "test1234!",
      role: Role.REQUESTER,
    },
    hashPassword,
  );

  return { admin, user };
}
