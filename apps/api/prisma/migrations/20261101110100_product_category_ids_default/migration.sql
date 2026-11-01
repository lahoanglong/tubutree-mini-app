-- Sản phẩm tạo mà không ghi categoryIds (đường đồng bộ Pancake cũ) mang NULL: Prisma đọc ra [] nhưng lọc `isEmpty` và câu
-- gán danh mục hàng loạt bỏ sót chúng. Đưa về mảng rỗng và đặt mặc định để hàng mới không còn NULL.
UPDATE "products" SET "categoryIds" = ARRAY[]::TEXT[] WHERE "categoryIds" IS NULL;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "categoryIds" SET DEFAULT ARRAY[]::TEXT[];
