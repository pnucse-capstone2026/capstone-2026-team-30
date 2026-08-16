import { Prisma } from "@prisma/client";
import {
  isPrismaKnownRequestError,
  PRISMA_ERROR_CODE,
  PrismaErrorCode,
} from "./prisma-error";

function createPrismaError(code: PrismaErrorCode) {
  return new Prisma.PrismaClientKnownRequestError("Prisma request failed.", {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe("isPrismaKnownRequestError", () => {
  it("matches a known Prisma error with the requested code", () => {
    const error = createPrismaError(
      PRISMA_ERROR_CODE.UNIQUE_CONSTRAINT_VIOLATION,
    );

    expect(
      isPrismaKnownRequestError(
        error,
        PRISMA_ERROR_CODE.UNIQUE_CONSTRAINT_VIOLATION,
      ),
    ).toBe(true);
  });

  it("rejects a different Prisma error code", () => {
    const error = createPrismaError(
      PRISMA_ERROR_CODE.UNIQUE_CONSTRAINT_VIOLATION,
    );

    expect(
      isPrismaKnownRequestError(error, PRISMA_ERROR_CODE.RECORD_NOT_FOUND),
    ).toBe(false);
  });

  it("rejects non-Prisma errors", () => {
    expect(
      isPrismaKnownRequestError(
        new Error("database unavailable"),
        PRISMA_ERROR_CODE.TRANSACTION_CONFLICT,
      ),
    ).toBe(false);
  });
});
