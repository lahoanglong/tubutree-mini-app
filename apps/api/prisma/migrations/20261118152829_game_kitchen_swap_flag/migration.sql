-- Căn Bếp Xanh (/vuon-xanh/choi/kitchen_swap): cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('game.mini.kitchen_swap.enabled', 'false'::jsonb, 'Bật game Căn Bếp Xanh (đổi đồ ở 3 góc nhà sang sản phẩm Tubu trong 45 giây, chỉ trên web); cần thêm game.mini.enabled và ít nhất 10 món đã bật trong admin, trải trên ít nhất 3 góc nhà có đủ sản phẩm còn hàng.', 'game', NOW())
ON CONFLICT ("key") DO NOTHING;
