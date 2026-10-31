INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-tier-upgraded', 'TIER_UPGRADED', 'INAPP', 'Chúc mừng bạn đã lên hạng {{tier}} tại Tubu Tree 🌿')
ON CONFLICT DO NOTHING;
