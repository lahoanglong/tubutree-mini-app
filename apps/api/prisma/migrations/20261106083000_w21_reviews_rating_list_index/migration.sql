-- Gói w21: danh sách đánh giá công khai lọc theo sao ở máy chủ (ReviewsService.listByProduct, ?rating=1..5):
-- WHERE productId AND isVisible AND rating ORDER BY createdAt DESC LIMIT 100. Index (productId, isVisible, createdAt DESC) phải
-- đọc lần lượt mọi đánh giá đang hiện của sản phẩm rồi bỏ dòng khác sao (sản phẩm nhiều 5 sao, chip "1 sao" đọc gần hết).
-- Không CONCURRENTLY vì migration chạy trong transaction: khoá chặn ghi reviews lúc dựng (bảng nhỏ).
-- Image cũ vẫn chạy đúng: không đổi cột, chỉ thêm index.
CREATE INDEX IF NOT EXISTS "reviews_productId_isVisible_rating_createdAt_idx"
  ON "reviews" ("productId", "isVisible", "rating", "createdAt" DESC);
