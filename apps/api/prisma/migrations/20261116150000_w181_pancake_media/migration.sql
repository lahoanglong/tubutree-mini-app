-- W181: media Pancake đầy đủ. Chỉ thêm cột (không đổi, không xoá dữ liệu có sẵn).
--   products.pancakeImages: ảnh nhận từ Pancake ở lần đồng bộ trước, để gộp ảnh mà không đè ảnh admin thêm trên Tubu Tree.
--   products.videos:        video từ variations[].videos của Pancake.
--   variations.imageUrl:    ảnh đầu của biến thể, để PDP đổi ảnh chính khi chọn biến thể.
ALTER TABLE "products" ADD COLUMN "pancakeImages" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "products" ADD COLUMN "videos" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "variations" ADD COLUMN "imageUrl" TEXT;
