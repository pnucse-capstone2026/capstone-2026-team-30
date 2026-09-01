import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { isPrismaKnownRequestError, PRISMA_ERROR_CODE } from "./prisma-error";
import { seedDefaultAccounts } from "../seed/admin-seed.service";
import { seedRbacPermissions } from "../seed/rbac-seed.service";

const SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS = 3;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    try {
      await seedRbacPermissions(
        this as unknown as Parameters<typeof seedRbacPermissions>[0],
      );
      await seedDefaultAccounts(
        this as unknown as Parameters<typeof seedDefaultAccounts>[0],
      );
      this.logger.log(
        "RBAC permissions and default accounts ensured successfully.",
      );
    } catch (e) {
      this.logger.warn(
        `Failed to auto-seed RBAC/accounts: ${(e as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async runSerializableTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (
      let attempt = 1;
      attempt <= SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        const shouldRetry =
          isPrismaKnownRequestError(
            error,
            PRISMA_ERROR_CODE.TRANSACTION_CONFLICT,
          ) && attempt < SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS;

        if (!shouldRetry) {
          throw error;
        }
      }
    }

    throw new Error("Serializable transaction retry limit exceeded.");
  }
}
