-- Giao diện mùa của Trang chủ (tubu-w57-01): Noel Xanh bật sẵn theo duyệt của PO 28/11. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('theme.seasonal', '"christmas"'::jsonb, 'Giao diện mùa của Trang chủ Mini App và web: "none" (mặc định), "christmas" (Noel Xanh: cây thông rung quà, lịch quà 12 ngày, tuyết rơi), "tet" (để dành, chưa có giao diện). Đổi ở Trung tâm tăng trưởng, không cần dựng lại app.', 'theme', NOW())
ON CONFLICT ("key") DO NOTHING;
