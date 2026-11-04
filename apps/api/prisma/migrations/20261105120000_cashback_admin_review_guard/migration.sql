-- Cột nullable, không backfill: dòng cũ coi như chưa có quyết định tay.
ALTER TABLE "cashback_transactions"
  ADD COLUMN "adminReviewedAt" TIMESTAMP(3),
  ADD COLUMN "adminReviewedBy" TEXT,
  ADD COLUMN "conflictNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "conflictPayload" JSONB;
