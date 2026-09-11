-- Snapshot slug sản phẩm trên từng dòng đơn hàng.
-- Không có nó, từ chi tiết đơn không mở được trang sản phẩm → khách nhận hàng xong không có
-- lối nào để đánh giá (audit mạch lạc B2C, P1-2), và các thao tác "mua lại đúng món này"
-- cũng không điều hướng được. Nullable vì đơn cũ không có dữ liệu để điền chính xác.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "productSlug" TEXT;

-- Điền ngược cho đơn cũ ở những dòng còn truy ra được sản phẩm qua variation.
UPDATE "order_items" oi
SET "productSlug" = p."slug"
FROM "variations" v
JOIN "products" p ON p."id" = v."productId"
WHERE oi."variationId" = v."id" AND oi."productSlug" IS NULL;
