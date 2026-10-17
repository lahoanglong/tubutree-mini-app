-- D2-08 freeship đơn đầu + D2-03 link nhận mã thẻ hộp hàng: tạo dòng để chủ dự án thấy và bật ở tab Cấu hình.
-- Giá trị bằng mặc định trong mã (tắt, ngưỡng 0, chưa có link): không đổi hành vi. DO NOTHING giữ giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('shipping.first_order_free_enabled', 'false'::jsonb, 'Freeship đơn đầu: true = khách thật chưa có đơn nào (trừ đơn huỷ) được miễn phí giao kiện Tubu', 'shipping', now()),
  ('shipping.first_order_free_min_subtotal', '0'::jsonb, 'Freeship đơn đầu: tiền hàng kiện Tubu tối thiểu (đồng, 0 = mọi đơn đầu)', 'shipping', now()),
  ('app.miniapp_base_url', '""'::jsonb, 'Link gốc Mini App (vd https://zalo.me/s/<appId>): dựng link nhận mã in trong QR thẻ hộp hàng và link chia sẻ của CTV', 'app', now())
ON CONFLICT ("key") DO NOTHING;
