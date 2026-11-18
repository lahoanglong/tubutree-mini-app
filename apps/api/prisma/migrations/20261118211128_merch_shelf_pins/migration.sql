-- Xếp kệ (tubu-w4-06): bảng món admin ghim theo kệ và ba khoá cấu hình (cờ TẮT). Chỉ thêm bảng mới và dòng cấu hình khi chưa có:
-- không đổi dữ liệu đang có, ảnh cũ không đọc bảng này nên chạy được với DB mới.
CREATE TABLE "merch_shelf_pins" (
    "id" TEXT NOT NULL,
    "shelfKey" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merch_shelf_pins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "merch_shelf_pins_shelfKey_position_idx" ON "merch_shelf_pins"("shelfKey", "position");

CREATE INDEX "merch_shelf_pins_productId_idx" ON "merch_shelf_pins"("productId");

CREATE UNIQUE INDEX "merch_shelf_pins_shelfKey_productId_key" ON "merch_shelf_pins"("shelfKey", "productId");

ALTER TABLE "merch_shelf_pins" ADD CONSTRAINT "merch_shelf_pins_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('merch.shelves_enabled', 'false'::jsonb, 'Xếp kệ: món admin ghim ở tab "Xếp kệ" đứng đầu danh sách mặc định (Gợi ý hôm nay ở Trang chủ, Danh mục chưa lọc), đầu trang từng danh mục và, khi chưa đủ số bán (merch.best_seller_min_products, merch.best_seller_min_sold), thay bảng Bán chạy nhất bằng kệ "Tubu chọn cho bạn". Chỉ món đang bán, còn hàng, trong khung giờ ghim. Tắt, hoặc bật mà chưa ghim món nào, thì mọi kệ như cũ.', 'merch', NOW()),
  ('merch.best_seller_min_products', '6'::jsonb, 'Số sản phẩm tối thiểu có lượt bán 30 ngày từ merch.best_seller_min_sold trở lên để bảng Bán chạy nhất xếp theo số bán thật. Ít hơn mức này và kệ best_sellers có món ghim thì khách thấy "Tubu chọn cho bạn" (cần merch.shelves_enabled bật).', 'merch', NOW()),
  ('merch.best_seller_min_sold', '3'::jsonb, 'Lượt bán 30 ngày (đơn đã giao trên app) để một sản phẩm được tính là "có số bán" khi xét ngưỡng merch.best_seller_min_products.', 'merch', NOW())
ON CONFLICT ("key") DO NOTHING;
