-- Bảng tin cộng đồng xếp "mới" (CommunityFeedService.getFeed, publicPreview): WHERE status = 'PUBLISHED'
-- ORDER BY isPinned DESC, createdAt DESC, id DESC LIMIT n. Index (status, isPinned DESC, likeCount DESC, createdAt DESC) chỉ
-- khớp xếp "phổ biến"; xếp "mới" phải quét tuần tự mọi bài đã đăng rồi sắp lại. Không CONCURRENTLY vì migration chạy trong
-- transaction: khoá chặn ghi feed_posts lúc dựng (bảng nhỏ so với orders/users).
CREATE INDEX IF NOT EXISTS "feed_posts_status_isPinned_createdAt_id_idx"
  ON "feed_posts" ("status", "isPinned" DESC, "createdAt" DESC, "id" DESC);
