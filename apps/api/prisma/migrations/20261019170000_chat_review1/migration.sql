-- chatpts sau review Opus lượt 1: cột phục vụ chống chuyển điểm sang SĐT khác (orderPhone), chốt tiền hàng lúc cộng (creditedGoodsValue),
-- trần theo người tạo đơn (creatorRef), mốc xác minh SĐT (phoneVerifiedAt) và con trỏ tạo bù (chatCheckedAt). Tất cả cột có thể null, thêm không khoá bảng lâu.
ALTER TABLE "users" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "external_orders" ADD COLUMN "chatCheckedAt" TIMESTAMP(3);
ALTER TABLE "external_points_claims"
  ADD COLUMN "orderPhone" TEXT,
  ADD COLUMN "creatorRef" TEXT,
  ADD COLUMN "creditedGoodsValue" INTEGER;
CREATE INDEX "external_points_claims_orderPhone_idx" ON "external_points_claims"("orderPhone");
CREATE INDEX "external_points_claims_creatorRef_createdAt_idx" ON "external_points_claims"("creatorRef", "createdAt");

-- Claim PHONE đã có (nếu cờ từng bật) lấy SĐT hiện trên đơn làm SĐT lúc tạo; điểm đã cộng lấy tiền hàng hiện tại của đơn.
UPDATE "external_points_claims" c SET "orderPhone" = o."phone"
  FROM "external_orders" o WHERE o."id" = c."externalOrderId" AND c."kind" = 'PHONE' AND o."phone" IS NOT NULL;
UPDATE "external_points_claims" c SET "creditedGoodsValue" = o."goodsValue"
  FROM "external_orders" o WHERE o."id" = c."externalOrderId" AND c."kind" = 'PHONE' AND c."state" IN ('CREDITED', 'REVERSED');

-- SĐT thành viên đang có đều từ Zalo (chỉ AuthService ghi cột này) nhưng chưa biết lúc nào: coi như vừa xác minh, đồng hồ 180 ngày bắt đầu từ đây.
UPDATE "users" SET "phoneVerifiedAt" = now() WHERE "phone" IS NOT NULL AND "phoneVerifiedAt" IS NULL;
