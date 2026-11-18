-- Thẻ xem trước chuyển khoản ở màn thanh toán: cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('checkout.transfer_preview_enabled', 'false'::jsonb, 'Màn thanh toán: khi khách chọn Chuyển khoản, hiện thẻ gọn có tên ngân hàng, tên chủ tài khoản và số tiền sẽ chuyển (chưa có mã QR; QR hiện sau khi bấm Đặt hàng). Thiếu một trong bốn khoá payment.bank_* thì thẻ ẩn. Tắt thì màn thanh toán như cũ trên Mini App và web.', 'checkout', NOW())
ON CONFLICT ("key") DO NOTHING;
