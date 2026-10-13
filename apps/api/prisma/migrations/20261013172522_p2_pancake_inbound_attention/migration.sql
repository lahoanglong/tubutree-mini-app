-- Hàng đợi "Cần xử lý Pancake": cột mới nullable, không đụng dữ liệu cũ.
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pancakeAttention" TEXT,
ADD COLUMN     "pancakeAttentionAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_pancakeAttentionAt_idx" ON "orders"("pancakeAttentionAt");

-- Mẫu tin báo admin (prod không chạy seed). DO NOTHING để không đè bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ops-pancake', 'OPS_PANCAKE_ALERT', 'INAPP', '⚠️ Đơn {{order_code}} cần xử lý (Pancake): {{message}}')
ON CONFLICT DO NOTHING;
