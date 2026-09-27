import { Prisma } from "@prisma/client";

export const PRISMA_ERROR_CODE = {
  UNIQUE_CONSTRAINT_VIOLATION: "P2002",
  RECORD_NOT_FOUND: "P2025",
  TRANSACTION_CONFLICT: "P2034",
} as const;

export type PrismaErrorCode =
  (typeof PRISMA_ERROR_CODE)[keyof typeof PRISMA_ERROR_CODE];

export function isPrismaKnownRequestError(
  error: unknown,
  code: PrismaErrorCode,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
