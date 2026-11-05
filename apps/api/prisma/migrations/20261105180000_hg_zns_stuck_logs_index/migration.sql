-- Gói hg: cron quét log ZNS kẹt lọc channel + status IN (PENDING, RETRYING) + sentAt cũ, sắp theo sentAt.
-- Index thường (tên theo Prisma): Prisma truyền channel/status là tham số nên generic plan không dùng được index một phần.
CREATE INDEX "notification_logs_channel_status_sentAt_idx" ON "notification_logs"("channel", "status", "sentAt");
