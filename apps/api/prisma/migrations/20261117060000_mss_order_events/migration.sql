-- Phát sự kiện đơn hàng sang MSS (hợp đồng tubu-mss-order-events v1.2): chỉ thêm cột có mặc định và một bảng mới.
-- Ảnh cũ chạy trên DB mới: ảnh cũ không đọc/ghi các cột này (INSERT lấy mặc định), không ai đọc bảng outbox.
-- Cờ `mss.order_events_enabled` (đã có từ 20261117040000_mss_foundation) mặc định TẮT: không dòng outbox nào được ghi.

ALTER TABLE "users" ADD COLUMN     "notifyOrderZalo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyOrderZaloAt" TIMESTAMP(3),
ADD COLUMN     "notifyOrderZaloSource" TEXT,
ADD COLUMN     "notifyOrderZaloTextVersion" TEXT;

ALTER TABLE "orders" ADD COLUMN     "mssEventSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orderZaloConsent" BOOLEAN,
ADD COLUMN     "orderZaloConsentAt" TIMESTAMP(3);

CREATE TABLE "mss_order_event_outbox" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "bodySha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "resultAt" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "znsHeldTemplate" TEXT,
    "znsHeldData" JSONB,
    "znsHeldAt" TIMESTAMP(3),
    "fallbackChannel" TEXT,
    "fallbackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mss_order_event_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mss_order_event_outbox_eventType_check" CHECK ("eventType" IN ('order.created', 'order.payment_confirmed', 'order.shipping', 'order.delivered', 'order.cancelled')),
    CONSTRAINT "mss_order_event_outbox_status_check" CHECK ("status" IN ('PENDING', 'SENDING', 'DELIVERED', 'RESULT_SENT', 'RESULT_SKIPPED', 'RESULT_FAILED', 'RESULT_UNKNOWN', 'DEAD', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT "mss_order_event_outbox_sequence_check" CHECK ("sequence" >= 1),
    CONSTRAINT "mss_order_event_outbox_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "mss_order_event_outbox_fallbackChannel_check" CHECK ("fallbackChannel" IS NULL OR "fallbackChannel" IN ('ZNS', 'IN_APP_ONLY'))
);

CREATE UNIQUE INDEX "mss_order_event_outbox_eventId_key" ON "mss_order_event_outbox"("eventId");

CREATE INDEX "mss_order_event_outbox_status_nextAttemptAt_idx" ON "mss_order_event_outbox"("status", "nextAttemptAt");

CREATE INDEX "mss_order_event_outbox_createdAt_idx" ON "mss_order_event_outbox"("createdAt");

-- Một đơn một tin cho mỗi loại ngay tại nguồn: INSERT ... ON CONFLICT ("orderId", "eventType") DO NOTHING.
CREATE UNIQUE INDEX "mss_order_event_outbox_orderId_eventType_key" ON "mss_order_event_outbox"("orderId", "eventType");

ALTER TABLE "mss_order_event_outbox" ADD CONSTRAINT "mss_order_event_outbox_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
