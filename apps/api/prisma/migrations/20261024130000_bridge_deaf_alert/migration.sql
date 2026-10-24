ALTER TABLE "support_bridge_status" ADD COLUMN "deaf" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ops-zalo-bridge-alert', 'OPS_ZALO_BRIDGE_ALERT', 'INAPP', '{{message}}')
ON CONFLICT DO NOTHING;
