-- Sửa thiếu sót của 20260622000000_coupon_atomic:
-- Postgres treat NULL=NULL = UNKNOWN → UNIQUE (couponId, orderId) cũ KHÔNG chặn
-- nhiều redemption có orderId=NULL của cùng coupon. Hiện redeem() luôn truyền orderId
-- nhưng để khoá idempotency tương lai (manual insert/seed) → thêm partial unique
-- chỉ apply khi orderId NOT NULL (an toàn cho prod).
--
-- Dedupe rows có cùng (couponId, orderId) NULL trước khi thêm constraint không kèm
-- (constraint cũ đã chặn case NOT NULL trùng); với NULL không thể dùng = → dùng
-- IS NOT DISTINCT FROM. Idempotent: IF NOT EXISTS.

DO $$
BEGIN
  -- Dedupe rows có orderId NULL trùng (couponId, userId): giữ id sớm nhất.
  DELETE FROM "coupon_redemptions" a
  USING "coupon_redemptions" b
  WHERE a.id > b.id
    AND a."couponId" = b."couponId"
    AND a."userId" = b."userId"
    AND a."orderId" IS NULL
    AND b."orderId" IS NULL;
END $$;

-- Partial unique chỉ apply khi orderId NOT NULL — bổ sung cho UNIQUE đã có
-- (UNIQUE(couponId,orderId) cũ đã chặn duplicate NOT NULL nhờ Postgres treat
-- mỗi NULL distinct; partial này không thay đổi hành vi rows NOT NULL,
-- chỉ rõ ràng intent và làm điểm bám cho enhance tương lai).
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_redemptions_couponId_orderId_notnull"
  ON "coupon_redemptions" ("couponId", "orderId")
  WHERE "orderId" IS NOT NULL;
