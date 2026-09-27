DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "PolicyExceptionRequest" LIMIT 1) THEN
    RAISE EXCEPTION 'PolicyExceptionRequest contains existing rows; migrate them explicitly before applying this migration';
  END IF;
END $$;

ALTER TYPE "ExceptionStatus" ADD VALUE 'APPLYING' AFTER 'PENDING';
ALTER TYPE "ExceptionStatus" ADD VALUE 'CANCELLING' AFTER 'REJECTED';
ALTER TYPE "ExceptionStatus" ADD VALUE 'EXPIRING' AFTER 'CANCELLING';

CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');

DROP INDEX "PolicyExceptionRequest_status_idx";
DROP INDEX "PolicyExceptionRequest_requestUserId_idx";

ALTER TABLE "PolicyExceptionRequest"
  ALTER COLUMN "status" SET DEFAULT 'PENDING',
  ALTER COLUMN "reason" TYPE VARCHAR(2000),
  ALTER COLUMN "policyName" TYPE VARCHAR(253),
  ALTER COLUMN "k8sExceptionName" TYPE VARCHAR(253),
  ADD COLUMN "ruleNames" TEXT[] NOT NULL,
  ADD COLUMN "appliedRuleNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "resourceKind" VARCHAR(63) NOT NULL,
  ADD COLUMN "resourceName" VARCHAR(253) NOT NULL,
  ADD COLUMN "resourceNamespace" VARCHAR(63),
  ADD COLUMN "targetClusterId" VARCHAR(128) NOT NULL,
  ADD COLUMN "targetClusterDisplayName" VARCHAR(253) NOT NULL,
  ADD COLUMN "decisionNote" VARCHAR(2000),
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ALTER COLUMN "approverUserId" DROP NOT NULL,
  ADD CONSTRAINT "PolicyExceptionRequest_ruleNames_nonempty" CHECK (cardinality("ruleNames") > 0),
  ADD CONSTRAINT "PolicyExceptionRequest_expiresAt_after_createdAt" CHECK ("expiresAt" > "createdAt");

CREATE UNIQUE INDEX "PolicyExceptionRequest_targetClusterId_k8sExceptionName_key"
  ON "PolicyExceptionRequest"("targetClusterId", "k8sExceptionName");
CREATE INDEX "PolicyExceptionRequest_status_createdAt_idx"
  ON "PolicyExceptionRequest"("status", "createdAt");
CREATE INDEX "PolicyExceptionRequest_status_expiresAt_idx"
  ON "PolicyExceptionRequest"("status", "expiresAt");
CREATE INDEX "PolicyExceptionRequest_requestUserId_createdAt_idx"
  ON "PolicyExceptionRequest"("requestUserId", "createdAt");

ALTER TABLE "AuditLog"
  ALTER COLUMN "action" TYPE VARCHAR(100),
  ALTER COLUMN "entityType" TYPE VARCHAR(100),
  ADD COLUMN "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
  ADD COLUMN "beforeStatus" "ExceptionStatus",
  ADD COLUMN "afterStatus" "ExceptionStatus",
  ADD COLUMN "metadata" JSONB,
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "AuditLog" ALTER COLUMN "actorType" DROP DEFAULT;
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actor_consistency" CHECK (
    ("actorType" = 'USER' AND "userId" IS NOT NULL)
    OR ("actorType" = 'SYSTEM' AND "userId" IS NULL)
  );
