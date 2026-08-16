ALTER TYPE "ExceptionStatus" ADD VALUE 'FAILED' AFTER 'CANCELLED';

ALTER TABLE "PolicyExceptionRequest"
  ADD COLUMN "applyAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastError" VARCHAR(1000),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "PolicyExceptionRequest_status_nextAttemptAt_idx"
  ON "PolicyExceptionRequest"("status", "nextAttemptAt");
