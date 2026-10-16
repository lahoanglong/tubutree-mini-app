ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deliveredEffectsAt" TIMESTAMP(3);

-- Đơn đã giao/đã trả trước bản này coi như đã xong việc sau giao: cron chạy lại chỉ được thấy đơn giao sau khi có mốc, không bao
-- giờ quét lại lịch sử. Chỉ chạm dòng chưa có mốc nên chạy lại không đổi gì.
UPDATE "orders"
   SET "deliveredEffectsAt" = COALESCE("deliveredAt", "updatedAt")
 WHERE "deliveredEffectsAt" IS NULL
   AND ("status" IN ('DELIVERED', 'RETURNED') OR "deliveredAt" IS NOT NULL);

-- Sức khoẻ hệ thống đếm mỗi 5 phút và cron quét mỗi 10 phút đúng tập này (DELIVERED chưa có mốc), luôn nhỏ nên index có điều
-- kiện. Prisma không khai được WHERE nên index chỉ sống ở migration (như orders_invoice_open_idx).
CREATE INDEX IF NOT EXISTS "orders_delivered_effects_pending_idx"
    ON "orders" ("deliveredAt")
 WHERE "status" = 'DELIVERED' AND "deliveredEffectsAt" IS NULL;
