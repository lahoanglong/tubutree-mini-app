-- Index cho truy vấn thực dùng của màn admin đơn/dashboard (C-027) và cron/inbox (C-052).
-- Chỉ thêm index (không đổi dữ liệu). CREATE INDEX thường (không CONCURRENTLY vì Prisma chạy migration
-- trong transaction) giữ khoá SHARE trên bảng tới khi xong: ghi vào orders/users/notification_logs bị
-- chờ trong lúc dựng index — chạy vào giờ thấp điểm (đo trên bản sao 200k đơn: xem impl/PB-1.md).

-- pg_trgm là extension "trusted" từ PG13: chủ DB tạo được không cần superuser. Cần gói contrib
-- (có sẵn trong image postgres chính thức và gói postgresql-contrib của Debian/Ubuntu).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Danh sách đơn admin không lọc + đơn mới nhất của dashboard (ORDER BY createdAt DESC LIMIT n).
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- Tìm đơn admin: mã đơn / mã Gomdon / SĐT / tên khách bằng LIKE/ILIKE '%x%'.
CREATE INDEX "orders_code_trgm_idx" ON "orders" USING GIN ("code" gin_trgm_ops);
CREATE INDEX "orders_gomdonPartnerCode_trgm_idx" ON "orders" USING GIN ("gomdonPartnerCode" gin_trgm_ops);
CREATE INDEX "users_phone_trgm_idx" ON "users" USING GIN ("phone" gin_trgm_ops);
CREATE INDEX "users_fullName_trgm_idx" ON "users" USING GIN ("fullName" gin_trgm_ops);

-- Inbox (userId + channel ORDER BY sentAt DESC) và chống nhắc lặp theo user; thay index [userId]
-- (là prefix của index mới nên không truy vấn nào mất index).
CREATE INDEX "notification_logs_userId_sentAt_idx" ON "notification_logs"("userId", "sentAt");
DROP INDEX "notification_logs_userId_idx";

-- Cron nhắc theo mẫu trong N ngày gần nhất.
CREATE INDEX "notification_logs_templateCode_sentAt_idx" ON "notification_logs"("templateCode", "sentAt");

-- Cron settle hoàn tiền / duyệt hoa hồng hết hold.
CREATE INDEX "cashback_transactions_status_confirmedAt_idx" ON "cashback_transactions"("status", "confirmedAt");
CREATE INDEX "commissions_status_lockedAt_idx" ON "commissions"("status", "lockedAt");

-- DAU theo ngày tạo refresh token.
CREATE INDEX "refresh_tokens_createdAt_idx" ON "refresh_tokens"("createdAt");
