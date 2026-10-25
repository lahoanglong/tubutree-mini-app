ALTER TABLE "account_deletion_requests"
  ADD COLUMN IF NOT EXISTS "walletForfeitAmount" INTEGER,
  ADD COLUMN IF NOT EXISTS "walletForfeitConsentAt" TIMESTAMP(3);
