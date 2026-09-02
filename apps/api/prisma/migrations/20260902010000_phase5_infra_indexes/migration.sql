-- Phase 5 (Cluster A) audit — index còn thiếu trên các bảng lớn, khớp đúng pattern query
-- thực tế trong service code (không phải suy đoán):
--
-- 1) orders(status, createdAt) — admin.service.ts listOrders() lọc theo `status` (không có
--    userId trong where) rồi sort createdAt desc; @@index([userId, status]) hiện có không
--    dùng được cho query này (userId không nằm trong where).
-- 2) commissions(orderId) — affiliate.service.ts lockCommissionsForOrder()/
--    reverseCommissionsForOrder() updateMany theo orderId trên MỌI lần đơn chuyển trạng thái
--    (DELIVERED/CANCELLED/RETURNED); trước đây không có index nào phủ orderId.
-- 3) points_transactions(expiresAt) — loyalty-expiry.service.ts 2 cron (1h & 8h sáng) quét
--    WHERE delta>0 AND expiresAt <=/BETWEEN now; chỉ có index(userId) không giúp được truy vấn này.
-- 4) DROP index dư thừa game_quiz_attempts_userId_idx: từ migration
--    20260902000000_game_quiz_attempt_daily_unique, @@unique([userId, quizId, dayKey]) đã phủ
--    mọi truy vấn lọc theo userId (leftmost prefix) — giữ cả 2 chỉ tốn thêm ghi mỗi insert.
--
-- !!! CẢNH BÁO PROD (giống 20260622010000 / 20260702040000) !!!
-- `CREATE INDEX` non-concurrent lấy SHARE lock, chặn write tới bảng đó tới khi build xong.
-- `orders`/`commissions`/`points_transactions` là các bảng lớn, tăng dần theo đơn hàng —
-- KHUYẾN NGHỊ: chạy CONCURRENTLY thủ công trên VM trước (tools/db/phase5-indexes-concurrently.sh)
-- rồi `prisma migrate resolve --applied 20260902010000_phase5_infra_indexes` để deploy skip.
-- IF NOT EXISTS / IF EXISTS → idempotent, an toàn chạy lại.

CREATE INDEX IF NOT EXISTS "orders_status_createdAt_idx" ON "orders"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "commissions_orderId_idx" ON "commissions"("orderId");
CREATE INDEX IF NOT EXISTS "points_transactions_expiresAt_idx" ON "points_transactions"("expiresAt");

DROP INDEX IF EXISTS "game_quiz_attempts_userId_idx";
