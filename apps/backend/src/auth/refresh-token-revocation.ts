import { Prisma } from "@prisma/client";

export function revokeAllRefreshTokensForUser(
  transaction: Prisma.TransactionClient,
  userId: string,
) {
  return transaction.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
