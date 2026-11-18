-- Đo tốc độ trên máy khách thật (Mini App và web): cờ mặc định TẮT, tỉ lệ lấy mẫu 100%. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('perf.rum_enabled', 'false'::jsonb, 'Đo tốc độ trên máy khách thật: web gửi LCP, CLS, INP, FCP, TTFB, Mini App gửi LCP, CLS và thời gian tới màn đầu bấm được, mỗi lượt xem trang một gói, chỉ mẫu route và nhóm khung nhìn (không URL thật, không mã khách). Tắt thì app không gửi gì và máy chủ bỏ mọi số đo.', 'perf', NOW()),
  ('perf.rum_sample_pct', '100'::jsonb, 'Phần trăm lượt xem trang được đo khi perf.rum_enabled bật (0–100). Lưu lượng còn thấp nên để 100; hạ xuống khi bảng sự kiện phình.', 'perf', NOW())
ON CONFLICT ("key") DO NOTHING;
