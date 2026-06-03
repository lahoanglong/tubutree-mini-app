-- Phase 3: thêm lockedAt cho commissions (đếm hold sau DELIVERED)
ALTER TABLE "commissions" ADD COLUMN "lockedAt" TIMESTAMP(3);
