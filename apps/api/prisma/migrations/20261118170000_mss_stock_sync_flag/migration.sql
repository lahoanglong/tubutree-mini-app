-- Nhận tồn kho MSS đẩy sang (wave tubu-w3-07): cờ mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('mss.stock_sync_enabled', 'false'::jsonb, 'Nhận tồn kho Pancake do MSS đẩy sang (POST /api/integrations/mss/catalog-sync) và áp ngay: hết hàng thì trang sản phẩm hiện "Báo tôi khi có hàng", về hàng thì gửi tin báo hàng về. Đồng bộ Pancake của Tubu vẫn chạy song song; số cũ hơn số đã áp bị bỏ. Tắt thì bỏ qua phần tồn MSS gửi.', 'mss', NOW())
ON CONFLICT ("key") DO NOTHING;
