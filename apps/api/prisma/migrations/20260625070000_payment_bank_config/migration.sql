-- Thanh toán chuyển khoản VietQR: thông tin TK ngân hàng shop (prod KHÔNG chạy prisma db seed).
-- Idempotent: DO NOTHING để không đè giá trị admin đã chỉnh. SỬA SỐ TK/TÊN thật qua admin config.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('payment.bank_bin', '"970407"'::jsonb, 'Mã ngân hàng Napas (BIN) nhận CK — 970407 = Techcombank', 'payment', now()),
  ('payment.bank_account_no', '"9984606774"'::jsonb, 'Số tài khoản nhận chuyển khoản (VietQR)', 'payment', now()),
  ('payment.bank_account_name', '"CONG TY TUBU TREE"'::jsonb, 'Tên chủ tài khoản (hiển thị; in hoa không dấu)', 'payment', now()),
  ('payment.bank_name', '"Techcombank"'::jsonb, 'Tên ngân hàng (hiển thị)', 'payment', now())
ON CONFLICT ("key") DO NOTHING;
