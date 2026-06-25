-- Back-office đại lý: lịch sử đổi giá (admin import giá) + template thông báo thưởng quý.

CREATE TABLE "dealer_price_history" (
    "id" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "oldPrice" INTEGER,
    "newPrice" INTEGER NOT NULL,
    "changedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dealer_price_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dealer_price_history_variationId_createdAt_idx" ON "dealer_price_history"("variationId", "createdAt");
CREATE INDEX "dealer_price_history_tierId_idx" ON "dealer_price_history"("tierId");
ALTER TABLE "dealer_price_history" ADD CONSTRAINT "dealer_price_history_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Template thông báo thưởng quý đại lý (prod KHÔNG chạy prisma db seed) — idempotent.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-dealer-bonus', 'DEALER_BONUS_PAID', 'INAPP', '🎁 Thưởng doanh số {{quarter}}: bạn được cộng {{amount}}đ vào công nợ đại lý (doanh số {{revenue}}đ). Cảm ơn bạn đã đồng hành cùng Tubu Tree 🌿')
ON CONFLICT ("id") DO UPDATE SET "code" = EXCLUDED."code", "channel" = EXCLUDED."channel", "bodyTemplate" = EXCLUDED."bodyTemplate";
