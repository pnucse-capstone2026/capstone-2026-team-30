ALTER TABLE "PolicyExceptionRequest"
  ADD COLUMN "reconcileClaimId" UUID,
  ADD COLUMN "reconcileLeaseUntil" TIMESTAMP(3);

ALTER TABLE "PolicyExceptionRequest"
  ADD CONSTRAINT "PolicyExceptionRequest_reconcile_claim_pair_check"
  CHECK (
    ("reconcileClaimId" IS NULL) = ("reconcileLeaseUntil" IS NULL)
  );
