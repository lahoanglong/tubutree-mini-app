INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-waste-gift-expired', 'WASTE_GIFT_EXPIRED', 'INAPP', 'Quà {{gift_name}} đã quá hạn nhận nên Tubu Tree đã huỷ và hoàn {{points}} điểm vào tài khoản của bạn.')
ON CONFLICT DO NOTHING;
