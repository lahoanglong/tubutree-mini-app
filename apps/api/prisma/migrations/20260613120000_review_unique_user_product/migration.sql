-- Mỗi user chỉ đánh giá 1 lần / sản phẩm (tránh farm điểm review).
-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_productId_key" ON "reviews"("userId", "productId");
