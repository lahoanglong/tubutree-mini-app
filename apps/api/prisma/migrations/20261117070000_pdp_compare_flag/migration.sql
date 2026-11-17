-- Bảng "So với món tương tự" trên trang sản phẩm: cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('catalog.pdp_compare_enabled', 'false'::jsonb, 'Trang sản phẩm hiện bảng "So với món tương tự": tối đa 2 món cùng phân khúc và cùng loại hàng (theo tên), còn hàng, kèm giá, dung tích và giá trên 100ml/100g. Tắt thì khối này ẩn trên Mini App và web.', 'catalog', NOW())
ON CONFLICT ("key") DO NOTHING;
