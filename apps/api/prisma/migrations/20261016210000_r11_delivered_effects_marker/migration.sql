ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deliveredEffectsAt" TIMESTAMP(3);

-- Đơn đã giao/đã trả trước bản này coi như đã xong việc sau giao: cron chạy lại chỉ được thấy đơn giao sau khi có mốc, không bao
-- giờ quét lại lịch sử. Chỉ chạm dòng chưa có mốc nên chạy lại không đổi gì.
UPDATE "orders"
   SET "deliveredEffectsAt" = COALESCE("deliveredAt", "updatedAt")
 WHERE "deliveredEffectsAt" IS NULL
   AND ("status" IN ('DELIVERED', 'RETURNED') OR "deliveredAt" IS NOT NULL);

-- Sức khoẻ hệ thống đếm mỗi 5 phút và cron quét mỗi 10 phút đơn đã giao chưa có mốc: tập luôn nhỏ nên index có điều kiện.
-- Điều kiện KHÔNG có status: Prisma gửi status = CAST($1::text AS "OrderStatus"), planner không gập được nên không chứng minh
-- được status = 'DELIVERED' và bỏ index; còn "deliveredAt" < $n (toán tử strict) thì kéo theo IS NOT NULL. status lọc trên
-- index. Prisma không khai được WHERE nên index chỉ sống ở migration (như orders_invoice_open_idx).
CREATE INDEX IF NOT EXISTS "orders_delivered_effects_pending_idx"
    ON "orders" ("deliveredAt")
 WHERE "deliveredEffectsAt" IS NULL AND "deliveredAt" IS NOT NULL;
