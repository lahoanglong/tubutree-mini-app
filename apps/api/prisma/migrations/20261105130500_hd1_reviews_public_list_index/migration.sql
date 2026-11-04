-- Danh sách đánh giá công khai (ReviewsService.listByProduct): WHERE productId AND isVisible ORDER BY createdAt DESC LIMIT n.
-- Index (productId) buộc đọc mọi đánh giá của sản phẩm rồi sắp lại; sản phẩm bán chạy có hàng chục nghìn đánh giá.
-- Không CONCURRENTLY vì migration chạy trong transaction: khoá chặn ghi reviews lúc dựng.
CREATE INDEX IF NOT EXISTS "reviews_productId_isVisible_createdAt_idx"
  ON "reviews" ("productId", "isVisible", "createdAt" DESC);
