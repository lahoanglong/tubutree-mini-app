-- w36-01: sự kiện giỏ bỏ quên gửi MSS (hợp đồng cart-events v1). Bảng mới, không đổi bảng cũ; image cũ không biết bảng này vẫn chạy như trước.
-- CreateTable
CREATE TABLE "mss_cart_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cartRef" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "cartUpdatedAt" TIMESTAMP(3) NOT NULL,
    "cartRemindedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "bodySha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultStatus" TEXT,
    "resultReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mss_cart_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mss_cart_events_eventId_key" ON "mss_cart_events"("eventId");

-- CreateIndex
CREATE INDEX "mss_cart_events_userId_type_createdAt_idx" ON "mss_cart_events"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "mss_cart_events_status_nextAttemptAt_idx" ON "mss_cart_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "mss_cart_events_createdAt_idx" ON "mss_cart_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mss_cart_events_cartRef_type_key" ON "mss_cart_events"("cartRef", "type");

-- AddForeignKey
ALTER TABLE "mss_cart_events" ADD CONSTRAINT "mss_cart_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hai cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('mss.cart_abandoned_zalo_enabled', 'false'::jsonb, 'Gửi giỏ bỏ quên sang MSS để nhắc khách một lần qua Zalo (chỉ khách đã đồng ý tin đơn qua Zalo và tin khuyến mãi).', 'mss', NOW()),
  ('retention.repurchase_due_card_enabled', 'false'::jsonb, 'Thẻ "Mua lại" ở Tài khoản và giỏ trống cho nước rửa chén, nước rửa rau đã nhận 25–40 ngày trước.', 'retention', NOW())
ON CONFLICT ("key") DO NOTHING;
