-- W42-01: lô Điểm Xanh MARKETPLACE (điểm tích từ đơn sàn, chỉ tiêu khi đặt đơn) và SĐT che của đơn sàn.
-- Chỉ thêm. Không dùng giá trị enum mới trong chính migration này (Postgres cấm dùng giá trị vừa ADD VALUE trong cùng giao dịch).

ALTER TYPE "PointsLot" ADD VALUE IF NOT EXISTS 'MARKETPLACE';

-- Cột có mặc định hằng: chỉ đổi metadata (PG >= 11), không ghi lại bảng.
ALTER TABLE "users" ADD COLUMN "pointsMarketplaceBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "users_points_marketplace_nonneg" CHECK ("pointsMarketplaceBalance" >= 0) NOT VALID;
ALTER TABLE "users" VALIDATE CONSTRAINT "users_points_marketplace_nonneg";

ALTER TABLE "orders" ADD COLUMN "pointsUsedMarketplace" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "return_requests" ADD COLUMN "marketplacePointsRefunded" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "external_orders" ADD COLUMN "phoneMask" TEXT;

-- Hoàn điểm lô MARKETPLACE khi huỷ/trả đơn: một dòng mỗi (lý do, đơn hoặc yêu cầu trả). Quét cả points_transactions khi dựng.
CREATE UNIQUE INDEX "points_transactions_marketplace_refund_unique" ON "points_transactions" ("reason", "refId")
  WHERE "reason" LIKE 'ORDER_REFUND_MARKETPLACE:%' OR "reason" LIKE 'RETURN_REFUND_MARKETPLACE:%';

-- Cờ tự mở Zalo Mini App trên web điện thoại (mặc định tắt; bật ở Quản trị sau khi thử máy thật).
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('app.mobile_miniapp_redirect_enabled', 'false'::jsonb, 'Tự mở Zalo Mini App 1 lần mỗi 24 giờ khi khách mở tubutree.com trên điện thoại.', 'app', NOW())
ON CONFLICT ("key") DO NOTHING;
