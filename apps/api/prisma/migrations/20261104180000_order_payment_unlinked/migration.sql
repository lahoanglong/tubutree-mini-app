-- Cờ "Pancake báo đã thanh toán nhưng đơn chưa gắn đúng đơn Pancake" tách khỏi ô chữ pancakeAttention.
-- Chỉ thêm cột nullable và một chỉ mục (không CONCURRENTLY, khoá ghi orders lúc dựng).
ALTER TABLE "orders" ADD COLUMN "paymentUnlinkedAt" TIMESTAMP(3);

CREATE INDEX "orders_paymentUnlinkedAt_idx" ON "orders"("paymentUnlinkedAt");
