import { Role } from "@prisma/client";
import argon2 from "argon2";

type ExistingUser = {
  id: string;
  email: string;
  role: Role;
};

type AdminSeedPrisma = {
  user: {
    findUnique(args: {
      where: { email: string };
    }): Promise<ExistingUser | null>;
    create(args: {
      data: { email: string; pwdHash: string; role: Role };
    }): Promise<ExistingUser>;
  };
};

type AdminSeedConfig = {
  email?: string;
  password?: string;
};

type AdminSeedResult = {
  created: boolean;
  user: ExistingUser;
};

export async function seedAdminUser(
  prisma: AdminSeedPrisma,
  config: AdminSeedConfig,
  hashPassword: (password: string) => Promise<string> = argon2.hash,
): Promise<AdminSeedResult> {
  const email = config.email?.trim().toLowerCase();
  const password = config.password;

  if (!email) {
    throw new Error("SEED_ADMIN_EMAIL is required.");
  }

  if (!password) {
    throw new Error("SEED_ADMIN_PASSWORD is required.");
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    return { created: false, user: existingUser };
  }

  const pwdHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      pwdHash,
      role: Role.ADMIN,
    },
  });

  return { created: true, user };
}
