ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "reversalEffectsAt" TIMESTAMP(3);

-- Đơn đã huỷ/trả trước bản này coi như đã xong phần đảo sau commit: cron chạy lại chỉ được thấy đơn đóng sau khi có cột, không bao
-- giờ quét lại lịch sử. Chỉ chạm dòng chưa có mốc nên chạy lại không đổi gì.
UPDATE "orders"
   SET "reversalEffectsAt" = "updatedAt"
 WHERE "reversalEffectsAt" IS NULL
   AND "status" IN ('CANCELLED', 'RETURNED');

-- Mọi đơn chưa đóng đều có mốc null nên điều kiện phải gồm status để chỉ mục chỉ chứa đơn đang chờ chạy lại (thường rỗng). Cron
-- truy vấn bằng SQL thô với đúng danh sách này: qua Prisma, status bị gói CAST($1::text AS "OrderStatus" ) nên planner không chứng
-- minh được vị từ và bỏ chỉ mục. Prisma không khai được WHERE nên chỉ mục chỉ sống ở migration.
CREATE INDEX IF NOT EXISTS "orders_reversal_effects_pending_idx"
    ON "orders" ("updatedAt", "id")
 WHERE "reversalEffectsAt" IS NULL AND "status" IN ('CANCELLED', 'RETURNED');
