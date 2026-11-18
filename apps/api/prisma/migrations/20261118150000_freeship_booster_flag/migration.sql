-- Dải "Thêm 1 món nhỏ để đủ Miễn phí giao hàng" ở đầu giỏ: cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('commerce.freeship_booster_enabled', 'false'::jsonb, 'Giỏ hàng (Mini App và web): dải gợi ý dưới thanh Miễn phí giao hàng đổi thành "Thêm 1 món nhỏ để đủ Miễn phí giao hàng": món Tubu giao còn hàng, chưa có trong giỏ, giá từ số còn thiếu tới số còn thiếu + 45.000đ xếp bán chạy 30 ngày trước, thiếu món thì bù bằng món bán chạy rẻ hơn. Mỗi món một chạm "+ Thêm", không rời giỏ. Tắt thì dải lấy từ kệ Bán chạy nhất như cũ.', 'commerce', NOW())
ON CONFLICT ("key") DO NOTHING;
