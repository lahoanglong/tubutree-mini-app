-- Một đánh giá cho mỗi lần mua: khoá (khách, sản phẩm) thành (khách, sản phẩm, đơn). Dữ liệu cũ đã thoả khoá mới vì
-- khoá cũ chặt hơn. Tạo khoá mới trước rồi mới bỏ khoá cũ để không có lúc nào bảng đứng không có ràng buộc.
-- Khoá bảng: CREATE UNIQUE INDEX (không CONCURRENTLY) giữ SHARE lock trên "reviews" suốt lúc dựng chỉ mục (chặn ghi đánh
-- giá, đọc vẫn chạy); DROP INDEX giữ ACCESS EXCLUSIVE trên "reviews" trong chốc lát. Bảng đánh giá nhỏ nên chỉ tính bằng
-- mili giây.

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_productId_orderId_key" ON "reviews"("userId", "productId", "orderId");

-- DropIndex
DROP INDEX "reviews_userId_productId_key";
