-- Báo cáo nguồn khách × tuần (admin): lọc khách theo ngày tạo và lấy đơn đầu/đơn hai của từng khách theo thời gian.
-- Không CONCURRENTLY vì migration chạy trong transaction; bảng còn gần rỗng trước launch.
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");
