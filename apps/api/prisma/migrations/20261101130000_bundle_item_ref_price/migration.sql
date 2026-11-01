-- AlterTable
ALTER TABLE "bundle_items" ADD COLUMN "refPrice" INTEGER;

-- backfill-begin
-- Món ADDON ghim phân loại lấy giá đang bán của phân loại làm giá tham chiếu (chưa có giá lúc tạo để dùng; bộ chưa lên PROD).
-- Dòng không ghim phân loại hay thuộc BUNDLE_PCT giữ NULL: ADDON thiếu giá tham chiếu không giảm và không được quảng cáo.
UPDATE "bundle_items" AS bi
SET "refPrice" = COALESCE(v."salePrice", v."retailPrice")
FROM "bundles" AS b, "variations" AS v
WHERE b."id" = bi."bundleId" AND b."kind" = 'ADDON' AND v."id" = bi."variationId" AND bi."refPrice" IS NULL;
-- backfill-end

-- Giá tham chiếu không âm: ghi tay hay đường khác cũng không lách được.
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_ref_price_chk" CHECK ("refPrice" IS NULL OR "refPrice" >= 0);
