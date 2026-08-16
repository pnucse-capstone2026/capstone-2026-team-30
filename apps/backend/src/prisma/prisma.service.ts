import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { isPrismaKnownRequestError, PRISMA_ERROR_CODE } from "./prisma-error";

const SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS = 3;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
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
