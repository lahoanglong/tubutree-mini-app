-- q6-platform-ops: webhook Pancake/Gomdon lỗi được admin "Đã xử lý" thì rời báo động (báo động không còn giới hạn 24 giờ).
ALTER TABLE "gomdon_webhook_events" ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "dismissedById" TEXT;

ALTER TABLE "pancake_webhook_events" ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "dismissedById" TEXT;

-- Ngưỡng báo động đơn thu gom chờ tạo vận đơn Gomdon (R2-GOMDON-4).
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('ops.alert_gomdon_backlog_minutes', '15'::jsonb, 'Đơn thu gom đã thanh toán được mà quá số phút này chưa có vận đơn Gomdon thì báo động', 'ops', now())
ON CONFLICT ("key") DO NOTHING;

UPDATE "system_configs"
   SET "description" = 'Báo động khi số webhook Pancake/Gomdon lỗi chưa ai xử lý từ mức này trở lên'
 WHERE "key" = 'ops.alert_webhook_failed';

-- Báo động phía Pancake không còn ghi vào gomdon_alerts (R2-ADMINOPS-5). Dòng cũ của đơn không thu gom là việc Pancake
-- (Gomdon chỉ chở đơn thu gom) — đóng lại; việc thật vẫn còn ở cột pancakeAttention của đơn.
UPDATE "gomdon_alerts" a
   SET "resolvedAt" = now()
  FROM "orders" o
 WHERE a."orderId" = o."id"
   AND a."resolvedAt" IS NULL
   AND o."hasRecyclingPickup" = false;
