-- Khung kết nối MSS (hợp đồng commerce v0.9 mục 0.5): chỉ thêm, không đổi dữ liệu có sẵn.
-- Ảnh cũ chạy trên DB mới: ảnh cũ không biết cột này, INSERT lấy mặc định PANCAKE_DIRECT, UPDATE không chạm cột nên trigger không bắn.

ALTER TABLE "orders" ADD COLUMN "backendRoute" TEXT NOT NULL DEFAULT 'PANCAKE_DIRECT';

ALTER TABLE "orders" ADD CONSTRAINT "orders_backendRoute_check" CHECK ("backendRoute" IN ('PANCAKE_DIRECT', 'MSS'));

-- Đường phía sau ghi lúc tạo đơn và không bao giờ đổi: lật cờ MSS chỉ ảnh hưởng đơn mới, không đơn nào bị đẩy hai đường.
CREATE FUNCTION "orders_backend_route_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'orders.backendRoute ghi lúc tạo đơn, không được đổi (đơn %)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_backend_route_immutable" BEFORE UPDATE OF "backendRoute" ON "orders"
  FOR EACH ROW WHEN (OLD."backendRoute" IS DISTINCT FROM NEW."backendRoute")
  EXECUTE FUNCTION "orders_backend_route_immutable"();

-- Cờ MSS, tất cả TẮT. ON CONFLICT DO NOTHING: không ghi đè giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('mss.catalog_enrichment_enabled', 'false'::jsonb, 'Lấy mô tả, ảnh, thành phần sản phẩm từ MSS. Tắt thì giữ nguồn hiện tại.', 'mss', NOW()),
  ('mss.order_events_enabled', 'false'::jsonb, 'Gửi sự kiện đơn sang MSS để MSS nhắn tin Zalo cho khách đã đồng ý. Tắt thì không gửi gì.', 'mss', NOW()),
  ('mss.order_events_rollout_pct', '0'::jsonb, 'Phần trăm đơn mới (0 đến 100) được gửi sự kiện tin Zalo khi cờ gửi sự kiện đơn bật.', 'mss', NOW()),
  ('mss.order_consent_prechecked', 'false'::jsonb, 'Ô đồng ý nhận tin đơn qua Zalo có được tick sẵn ở bước đặt hàng không.', 'mss', NOW()),
  ('mss.customer_sync_enabled', 'false'::jsonb, 'Đồng bộ hồ sơ khách sang MSS. Tắt thì không gửi dữ liệu khách.', 'mss', NOW()),
  ('mss.order_push_enabled', 'false'::jsonb, 'Đơn mới đi qua MSS thay vì đẩy thẳng Pancake. Chỉ ảnh hưởng đơn tạo sau khi bật.', 'mss', NOW()),
  ('mss.order_status_enabled', 'false'::jsonb, 'Nhận trạng thái đơn từ MSS cho đơn đi đường MSS.', 'mss', NOW()),
  ('mss.invoice_enabled', 'false'::jsonb, 'Yêu cầu hoá đơn điện tử qua MSS cho đơn đi đường MSS.', 'mss', NOW()),
  ('mss.catalog_shadow_enabled', 'false'::jsonb, 'Đọc thử danh mục từ MSS để so với Pancake, không hiện cho khách.', 'mss', NOW()),
  ('mss.catalog_source', '"pancake"'::jsonb, 'Nguồn SKU, giá, tồn kho: pancake (hiện tại) hoặc mss.', 'mss', NOW())
ON CONFLICT ("key") DO NOTHING;
