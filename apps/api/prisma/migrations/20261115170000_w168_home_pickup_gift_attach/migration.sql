-- W168: đơn thu gom độc lập (HOME_PICKUP) qua Gomdon, cân nặng rác kèm đơn, quà hiện vật gắn vào đơn mua kế tiếp.
-- Chỉ thêm giá trị enum + cột nullable + chỉ mục: tương thích ngược, không đụng dữ liệu cũ.
-- Giá trị enum mới không được dùng trong cùng file này (Postgres cấm dùng ngay trong cùng giao dịch).
ALTER TYPE "WasteMethod" ADD VALUE IF NOT EXISTS 'HOME_PICKUP';

ALTER TABLE "orders" ADD COLUMN "recyclingWeightGrams" INTEGER;

ALTER TABLE "waste_requests"
  ADD COLUMN "gomdonOrderId" TEXT,
  ADD COLUMN "gomdonPartnerCode" TEXT,
  ADD COLUMN "gomdonStatus" TEXT,
  ADD COLUMN "gomdonStatusAt" TIMESTAMP(3),
  ADD COLUMN "declaredWeightGrams" INTEGER,
  ADD COLUMN "shipFeeVnd" INTEGER,
  ADD COLUMN "shipFeePointsUsed" INTEGER,
  ADD COLUMN "shipFeeCodVnd" INTEGER,
  ADD COLUMN "shipFeePointsRefunded" INTEGER,
  ADD COLUMN "pickupAddress" JSONB,
  ADD COLUMN "shippingHistory" JSONB;

CREATE INDEX "waste_requests_gomdonOrderId_idx" ON "waste_requests"("gomdonOrderId");
CREATE INDEX "waste_requests_gomdonPartnerCode_idx" ON "waste_requests"("gomdonPartnerCode");

ALTER TABLE "waste_gift_redemptions" ADD COLUMN "attachedOrderId" TEXT;
CREATE INDEX "waste_gift_redemptions_attachedOrderId_idx" ON "waste_gift_redemptions"("attachedOrderId");
ALTER TABLE "waste_gift_redemptions" ADD CONSTRAINT "waste_gift_redemptions_attachedOrderId_fkey" FOREIGN KEY ("attachedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
