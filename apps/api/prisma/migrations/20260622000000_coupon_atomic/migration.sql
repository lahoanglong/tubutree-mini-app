-- B4: Coupon redemption atomic — chống race usageLimit / orderId trùng.
-- An toàn trên DB prod đang có dữ liệu: idempotent, backfill an toàn, không drop cột.

-- Bước 1: Thêm cột usedCount (bộ đếm atomic dùng cho updateMany guard).
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "usedCount" INTEGER NOT NULL DEFAULT 0;

-- Bước 2: Backfill usedCount từ số redemption hiện có (an toàn re-run).
UPDATE "coupons" c
SET "usedCount" = COALESCE((
  SELECT COUNT(*) FROM "coupon_redemptions" cr WHERE cr."couponId" = c.id
), 0);

-- Bước 3: Thêm unique (couponId, orderId) cho idempotency retry.
-- Dọn trùng (nếu có) trước khi thêm constraint để không fail trên dữ liệu cũ.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupon_redemptions_couponId_orderId_key'
  ) THEN
    DELETE FROM "coupon_redemptions" a
    USING "coupon_redemptions" b
    WHERE a.id > b.id AND a."couponId" = b."couponId" AND a."orderId" = b."orderId";

    ALTER TABLE "coupon_redemptions"
      ADD CONSTRAINT "coupon_redemptions_couponId_orderId_key" UNIQUE ("couponId", "orderId");
  END IF;
END $$;
