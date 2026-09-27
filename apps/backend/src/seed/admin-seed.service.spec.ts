import { Role } from "@prisma/client";
import {
  seedAdminUser,
  seedDefaultAccounts,
  seedUserAccount,
} from "./admin-seed.service";

describe("seedAdminUser & seedUserAccount", () => {
  const adminUser = {
    id: "user-admin",
    email: "admin@test.com",
    role: Role.ADMIN,
  };

  const normalUser = {
    id: "user-regular",
    email: "user@test.com",
    role: Role.REQUESTER,
  };

  it("creates an admin user admin@test.com with password test1234! when one does not exist", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(adminUser),
        update: jest.fn(),
      },
    };
    const hashPassword = jest.fn().mockResolvedValue("hashed-test1234!");

    const result = await seedAdminUser(
      prisma,
      {
        email: "admin@test.com",
        password: "test1234!",
      },
      hashPassword,
    );

    expect(result).toEqual({ created: true, updated: false, user: adminUser });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "admin@test.com" },
    });
    expect(hashPassword).toHaveBeenCalledWith("test1234!");
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "admin@test.com",
        pwdHash: "hashed-test1234!",
        role: Role.ADMIN,
      },
    });
  });

  it("resets password for existing admin user to guarantee fixed credentials", async () => {
    const updatedAdmin = { ...adminUser, pwdHash: "hashed-test1234!" };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(adminUser),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(updatedAdmin),
      },
    };
    const hashPassword = jest.fn().mockResolvedValue("hashed-test1234!");

    const result = await seedAdminUser(
      prisma,
      {
        email: "admin@test.com",
        password: "test1234!",
        forceResetPassword: true,
      },
      hashPassword,
    );

    expect(result).toEqual({
      created: false,
      updated: true,
      user: updatedAdmin,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-admin" },
      data: { pwdHash: "hashed-test1234!", role: Role.ADMIN },
    });
  });

  it("creates user@test.com with password test1234!", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(normalUser),
        update: jest.fn(),
      },
    };
    const hashPassword = jest.fn().mockResolvedValue("hashed-test1234!");

    const result = await seedUserAccount(
      prisma,
      {
        email: "user@test.com",
        password: "test1234!",
      },
      hashPassword,
    );

    expect(result).toEqual({ created: true, updated: false, user: normalUser });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "user@test.com",
        pwdHash: "hashed-test1234!",
        role: Role.REQUESTER,
      },
    });
  });

  it("seeds both default accounts via seedDefaultAccounts", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => {
          if (data.email === "admin@test.com") return adminUser;
          return normalUser;
        }),
        update: jest.fn(),
      },
    };
    const hashPassword = jest.fn().mockResolvedValue("hashed-test1234!");

    const { admin, user } = await seedDefaultAccounts(prisma, {}, hashPassword);

    expect(admin.user.email).toBe("admin@test.com");
    expect(user.user.email).toBe("user@test.com");
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
  });
});
