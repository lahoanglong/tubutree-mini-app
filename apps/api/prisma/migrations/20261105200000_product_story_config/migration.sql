-- Cấu hình câu chuyện sản phẩm: cột nullable, an toàn với dữ liệu hiện có.
ALTER TABLE "products" ADD COLUMN "storyConfig" JSONB;
