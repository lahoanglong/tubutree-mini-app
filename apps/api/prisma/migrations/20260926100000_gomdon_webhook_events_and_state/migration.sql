-- Hoàn thiện tích hợp Gomdon (đơn đổi hàng thu gom tái chế) — chạy SAU 20260919220000_order_recycling_gomdon.
--
-- 1) orders: thêm mốc thời gian trạng thái Gomdon (chặn webhook tới trễ lùi trạng thái) và kết quả
--    huỷ vận đơn Gomdon khi đơn bị huỷ (CANCELLED | FAILED | TOO_LATE | NOT_NEEDED).
-- 2) gomdon_webhook_events: lưu mọi webhook Gomdon đã qua xác thực (audit + replay + chống xử lý trùng
--    qua dedupeKey unique), xử lý async qua queue gomdon-events.
--
-- An toàn với dữ liệu hiện có: chỉ THÊM cột nullable + bảng/index mới, không sửa/xoá cột nào.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gomdonStatusAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gomdonCancelStatus" TEXT;

CREATE INDEX IF NOT EXISTS "orders_hasRecyclingPickup_gomdonStatus_idx"
  ON "orders" ("hasRecyclingPickup", "gomdonStatus");

CREATE TABLE IF NOT EXISTS "gomdon_webhook_events" (
  "id"            TEXT NOT NULL,
  "dedupeKey"     TEXT NOT NULL,
  "gomdonOrderId" TEXT,
  "orderCode"     TEXT,
  "gomdonStatus"  INTEGER,
  "eventTime"     TIMESTAMP(3),
  "rawPayload"    JSONB NOT NULL,
  "receivedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"   TIMESTAMP(3),
  "status"        TEXT NOT NULL,
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "error"         TEXT,
  "orderId"       TEXT,
  CONSTRAINT "gomdon_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gomdon_webhook_events_dedupeKey_key"
  ON "gomdon_webhook_events" ("dedupeKey");

CREATE INDEX IF NOT EXISTS "gomdon_webhook_events_status_receivedAt_idx"
  ON "gomdon_webhook_events" ("status", "receivedAt");

CREATE INDEX IF NOT EXISTS "gomdon_webhook_events_gomdonOrderId_idx"
  ON "gomdon_webhook_events" ("gomdonOrderId");

-- 3) orders.deliveredAt: mốc DELIVERED thật để tính hạn đổi/trả (trước đây dùng updatedAt — webhook vận
--    chuyển/yêu cầu hoá đơn ghi sau khi giao làm hạn đổi/trả bị kéo dài quá mốc duyệt hoa hồng CTV).
--    Backfill: lần chuyển DELIVERED cuối trong order_status_history; đơn DELIVERED cũ không có vết
--    (trước khi có bảng lịch sử) → updatedAt (giữ đúng hành vi cũ, không làm tệ hơn).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

UPDATE "orders" AS o
SET "deliveredAt" = h."at"
FROM (
  SELECT "orderId", MAX("createdAt") AS "at"
  FROM "order_status_history"
  WHERE "toStatus" = 'DELIVERED'
  GROUP BY "orderId"
) AS h
WHERE o."id" = h."orderId" AND o."deliveredAt" IS NULL;

UPDATE "orders" SET "deliveredAt" = "updatedAt" WHERE "status" = 'DELIVERED' AND "deliveredAt" IS NULL;

-- 4) Dữ liệu vận hành (idempotent, như 20260926130000_dealer_reward_claims): config KHÔNG ghi đè giá
--    trị admin đã chỉnh; template cập nhật nội dung.
--    - shipping.gomdon.config: CHỈ phần không bí mật (kho lấy hàng + cân nặng mặc định). Tài khoản Gomdon
--      đặt qua env GOMDON_PHONE/GOMDON_PASSWORD.
--    - shipping.gomdon.recycling_enabled: công tắc hiện lựa chọn thu gom ở checkout (mặc định TẮT).
--    - returns.window_days: khoá code THẬT SỰ đọc (orders.service/affiliate.service). Seed cũ ghi nhầm
--      'return.window_days' (15, không ai đọc) → hiệu lực thực tế vẫn là mặc định 7 ngày, khớp chính sách
--      đang công bố trên app ("đổi/trả trong 7 ngày").
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('shipping.gomdon.config',
   '{"defaultWarehouse":{"name":"Fuwa3e Tubu HCM","phone":"0965573541","address":"Golf Park, 1 đường số 2","ward":"Phường Long Bình","district":"Thành phố Thủ Đức","province":"Thành phố Hồ Chí Minh"},"defaultWeightFallback":500}'::jsonb,
   'Gomdon (đơn đổi hàng thu gom tái chế): kho lấy hàng + cân nặng mặc định (gram). Tài khoản đặt qua env GOMDON_PHONE/GOMDON_PASSWORD.',
   'shipping', now()),
  ('shipping.gomdon.recycling_enabled', 'false'::jsonb,
   'Bật lựa chọn "Gửi lại vật liệu tái chế" ở checkout (chỉ hiện khi Gomdon đã cấu hình env)',
   'shipping', now()),
  ('returns.window_days', '7'::jsonb, 'Số ngày từ khi giao (DELIVERED) được yêu cầu đổi/trả', 'return', now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ops-gomdon', 'OPS_GOMDON_ALERT', 'INAPP', '⚠️ Vận đơn thu gom đơn {{order_code}}: {{message}}')
ON CONFLICT ("id") DO UPDATE SET "code" = EXCLUDED."code", "channel" = EXCLUDED."channel", "bodyTemplate" = EXCLUDED."bodyTemplate";
