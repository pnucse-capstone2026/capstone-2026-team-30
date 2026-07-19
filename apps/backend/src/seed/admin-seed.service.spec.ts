import { Role } from "@prisma/client";
import { seedAdminUser } from "./admin-seed.service";

describe("seedAdminUser", () => {
  const adminUser = {
    id: "user-admin",
    email: "admin@example.com",
    role: Role.ADMIN,
  };

  it("creates an admin user when one does not exist", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(adminUser),
      },
    };
    const hashPassword = jest.fn().mockResolvedValue("hashed-password");

    const result = await seedAdminUser(
      prisma,
      {
        email: "Admin@Example.com ",
        password: "plain-password",
      },
      hashPassword,
    );

    expect(result).toEqual({ created: true, user: adminUser });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "admin@example.com" },
    });
    expect(hashPassword).toHaveBeenCalledWith("plain-password");
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "admin@example.com",
        pwdHash: "hashed-password",
        role: Role.ADMIN,
      },
    });
  });

  it("does not create a duplicate admin user", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(adminUser),
        create: jest.fn(),
      },
    };
    const hashPassword = jest.fn();

    const result = await seedAdminUser(
      prisma,
      {
        email: "admin@example.com",
        password: "plain-password",
      },
      hashPassword,
    );

    expect(result).toEqual({ created: false, user: adminUser });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("requires an admin email", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    await expect(
      seedAdminUser(prisma, { password: "plain-password" }),
    ).rejects.toThrow("SEED_ADMIN_EMAIL is required.");
  });

  it("requires an admin password", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    await expect(
      seedAdminUser(prisma, { email: "admin@example.com" }),
    ).rejects.toThrow("SEED_ADMIN_PASSWORD is required.");
  });
});
