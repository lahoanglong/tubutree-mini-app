-- D2-03: mã ẩn nhận qua thẻ QR trong hộp hàng sàn, cờ "chỉ khách mới" và lô mã in thẻ.
-- Mã CLAIM chỉ vào ví khách sau khi khách nhận (coupon_claims); newCustomerOnly mặc định false nên mã cũ giữ nguyên hành vi.
ALTER TYPE "CouponScope" ADD VALUE 'CLAIM';

ALTER TABLE "coupons" ADD COLUMN     "batch" TEXT,
ADD COLUMN     "newCustomerOnly" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "coupon_claims" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coupon_claims_userId_idx" ON "coupon_claims"("userId");

CREATE UNIQUE INDEX "coupon_claims_couponId_userId_key" ON "coupon_claims"("couponId", "userId");

CREATE INDEX "coupons_batch_idx" ON "coupons"("batch");

ALTER TABLE "coupon_claims" ADD CONSTRAINT "coupon_claims_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
