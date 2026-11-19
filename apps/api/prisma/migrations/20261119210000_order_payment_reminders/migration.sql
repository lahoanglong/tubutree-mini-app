-- Số lần MSS nhắc khách chuyển khoản và lúc nhắc gần nhất, đọc từ khối payment_rescue của webhook order-status (tubu-w8-01, hợp đồng W4-02).
-- Hai cột cộng, cho phép null: đơn cũ và đơn MSS chưa báo giữ null, màn admin không hiện gì.
ALTER TABLE "orders" ADD COLUMN "paymentRemindersSent" INTEGER;
ALTER TABLE "orders" ADD COLUMN "paymentLastRemindedAt" TIMESTAMP(3);
