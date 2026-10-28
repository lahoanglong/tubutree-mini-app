-- Hoa hồng CTV đã duyệt tự vào Ví Tubu. Chỉ thêm dòng dữ liệu (không đổi schema); mọi câu idempotent, không đè nội dung admin đã chỉnh.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('affiliate.auto_wallet_transfer_enabled', 'true'::jsonb, 'true = hoa hồng CTV đã duyệt tự chuyển vào Ví Tubu sau mỗi lượt duyệt (cùng khấu trừ thuế TNCN và sổ Ví như CTV bấm Chuyển vào Ví); false = CTV tự bấm Chuyển vào Ví', 'affiliate', now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ctv-wallet-credited', 'COMMISSION_WALLET_CREDITED', 'INAPP', '💰 Đã cộng {{amount}} hoa hồng vào Ví Tubu{{tax_note}}. Bạn dùng được ngay khi thanh toán đơn hàng.')
ON CONFLICT DO NOTHING;

UPDATE "notification_templates" SET "bodyTemplate" = '✅ {{count}} khoản hoa hồng (tổng {{amount}}) đã được duyệt. Khoản này chưa tự vào Ví, bạn chuyển vào Ví Tubu ngay trong mục CTV nhé.'
WHERE "code" = 'COMMISSION_APPROVED'
  AND "bodyTemplate" = '✅ {{count}} khoản hoa hồng (tổng {{amount}}) đã được duyệt. Bạn có thể chuyển vào Ví Tubu ngay trong mục CTV.';
