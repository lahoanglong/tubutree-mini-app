-- w35-01 (PO A1): khách bật ở bước đặt hàng "gửi thêm thông báo giao hàng (không kèm giá) cho số người nhận". Cột mặc định hằng số nên
-- ADD COLUMN chỉ đổi metadata (PG11+); image cũ không biết hai cột mới vẫn đọc/ghi như trước.
ALTER TABLE "orders" ADD COLUMN "notifyRecipientZalo" BOOLEAN NOT NULL DEFAULT false;

-- Mỗi đơn mỗi loại sự kiện có tối đa một dòng cho người mua và một dòng cho người nhận. Bảng outbox nhỏ (chỉ có dòng khi cờ order_events bật).
ALTER TABLE "mss_order_event_outbox" ADD COLUMN "recipientRole" TEXT NOT NULL DEFAULT 'buyer';
DROP INDEX "mss_order_event_outbox_orderId_eventType_key";
CREATE UNIQUE INDEX "mss_order_event_outbox_orderId_eventType_recipientRole_key" ON "mss_order_event_outbox"("orderId", "eventType", "recipientRole");

-- Cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('mss.order_recipient_enabled', 'false'::jsonb, 'Gửi thêm tin giao hàng (không kèm giá) cho số người nhận khi khách bật ở bước đặt hàng.', 'mss', NOW())
ON CONFLICT ("key") DO NOTHING;
