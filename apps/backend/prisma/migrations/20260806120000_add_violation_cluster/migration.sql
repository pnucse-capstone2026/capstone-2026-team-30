-- 이 테이블은 아직 읽고 쓰는 코드가 없어 비어 있다. 그래도 기존 행이 있는 환경에서
-- 깨지지 않도록 NOT NULL 컬럼은 임시 기본값을 붙여 추가한 뒤 기본값을 떼어낸다.
-- (기본값을 남기면 Prisma 스키마와 어긋나 migrate diff 가 드리프트로 잡는다.)
ALTER TABLE "ViolationHistory"
  ADD COLUMN "targetClusterId" VARCHAR(128) NOT NULL DEFAULT 'unknown',
  ADD COLUMN "targetClusterDisplayName" VARCHAR(253) NOT NULL DEFAULT 'unknown';

ALTER TABLE "ViolationHistory"
  ALTER COLUMN "targetClusterId" DROP DEFAULT,
  ALTER COLUMN "targetClusterDisplayName" DROP DEFAULT;

CREATE INDEX "ViolationHistory_targetClusterId_occurredAt_idx"
  ON "ViolationHistory"("targetClusterId", "occurredAt");
