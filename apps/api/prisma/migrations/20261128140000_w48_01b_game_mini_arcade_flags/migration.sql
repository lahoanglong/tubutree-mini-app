-- Ghép Mầm Xanh (eco_merge) và Băng Chuyền Xanh (green_conveyor): PO duyệt bật mặc định (28/11). Hai game chạy luật cài sẵn, không cần mục
-- nội dung; thưởng đi chung công thức và trần của game mini (game.mini.*_daily_cap, rounds_per_game_per_day). Chỉ thêm dòng khi chưa có,
-- không đổi giá trị admin đã đặt; vẫn cần game.mini.enabled bật mới hiện.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('game.mini.eco_merge.enabled', 'true'::jsonb, 'Bật game Ghép Mầm Xanh (ghép ô cây 4×4 tới Rừng Tubu trong 3 phút); cần thêm game.mini.enabled. Không cần mục nội dung.', 'game', NOW()),
  ('game.mini.green_conveyor.enabled', 'true'::jsonb, 'Bật game Băng Chuyền Xanh (phân 24 món vào Tái chế, Hữu cơ, Refill trong 30 giây); cần thêm game.mini.enabled. Không cần mục nội dung.', 'game', NOW())
ON CONFLICT ("key") DO NOTHING;
