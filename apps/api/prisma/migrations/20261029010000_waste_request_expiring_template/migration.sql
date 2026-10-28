INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-waste-request-expiring', 'WASTE_REQUEST_EXPIRING', 'INAPP', 'Yêu cầu {{code}} sắp hết hạn giữ chỗ vào ngày {{until}}. Bạn nhớ {{next_step}} trước ngày đó nhé.')
ON CONFLICT DO NOTHING;
