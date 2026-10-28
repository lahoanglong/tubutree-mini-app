ALTER TABLE "users" ADD COLUMN "tierDropNoticeFor" TIMESTAMP(3);

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-tier-drop-notice', 'TIER_DROP_NOTICE', 'INAPP', '⚠️ Hạng {{tier}} của bạn được giữ đến {{date}}. {{need}} trước ngày đó để giữ hạng nhé 🌿')
ON CONFLICT DO NOTHING;
