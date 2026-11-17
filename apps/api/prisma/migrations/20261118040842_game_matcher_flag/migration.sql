-- Chọn Chuẩn Xanh (/vuon-xanh/chon-chuan-xanh): cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('game.matcher_enabled', 'false'::jsonb, 'Bật Chọn Chuẩn Xanh: 3 câu nhu cầu + 2 câu đố có nguồn, ra bộ 2–4 món còn hàng để thêm cả bộ vào giỏ (chỉ trên web; Mini hiện một dòng dẫn sang web). Cần bật nội dung matcher trong admin. Tắt thì API trả 404 và lối vào ẩn.', 'game', NOW())
ON CONFLICT ("key") DO NOTHING;
