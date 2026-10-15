-- PLATFORM-5: trạng thái vận hành ghi bền + ngưỡng báo động sức khoẻ hệ thống + mẫu thông báo cho admin.
CREATE TABLE "ops_health_states" (
    "key" TEXT NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "detail" JSONB,
    "alertSince" TIMESTAMP(3),
    "alertedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_health_states_pkey" PRIMARY KEY ("key")
);

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('ops.alert_unsynced_minutes', '30'::jsonb, 'Đơn còn ở kho mà quá số phút này chưa lên Pancake thì tính là đơn kẹt', 'ops', now()),
  ('ops.alert_stuck_orders', '1'::jsonb, 'Báo động khi số đơn kẹt chưa lên Pancake từ mức này trở lên', 'ops', now()),
  ('ops.alert_webhook_failed', '1'::jsonb, 'Báo động khi số webhook Pancake/Gomdon xử lý lỗi trong 24 giờ từ mức này trở lên', 'ops', now()),
  ('ops.alert_queue_failed_1h', '5'::jsonb, 'Báo động khi một hàng đợi có từ chừng này job lỗi trong 1 giờ qua', 'ops', now()),
  ('ops.alert_repeat_hours', '6'::jsonb, 'Sự cố chưa hết thì nhắc lại admin sau chừng này giờ', 'ops', now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ops-health', 'OPS_HEALTH_ALERT', 'INAPP', '{{title}}: {{summary}}')
ON CONFLICT ("id") DO NOTHING;
