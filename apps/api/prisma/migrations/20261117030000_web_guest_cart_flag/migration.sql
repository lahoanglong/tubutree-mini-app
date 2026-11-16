-- Giỏ khách trên web: cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('web.guest_cart_enabled', 'false'::jsonb, 'Khách chưa đăng nhập trên web được thêm món vào giỏ và xem giỏ (giá, tạm tính, Miễn phí giao hàng); đăng nhập vẫn bắt buộc ở bước đặt hàng. Tắt thì khách bấm mua là sang trang đăng nhập như cũ.', 'web', NOW())
ON CONFLICT ("key") DO NOTHING;
