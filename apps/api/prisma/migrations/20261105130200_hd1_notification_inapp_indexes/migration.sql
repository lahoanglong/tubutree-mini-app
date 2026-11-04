-- Hộp tin in-app của khách (NotificationFeedService.list / listForUser: userId + channel = 'INAPP' ORDER BY sentAt DESC, id DESC)
-- và số chưa đọc (unreadCount, markAllRead: INAPP và status <> 'READ'). Index (userId, sentAt) hiện có lẫn cả tin ZNS của khách,
-- nên phải lọc channel từng dòng rồi sắp lại theo (sentAt, id).
-- channel nằm trong khoá thay vì WHERE: Prisma chạy prepared statement, sau vài lần planner chuyển sang generic plan với
-- channel = $n và khi đó index một phần WHERE channel = 'INAPP' không bao giờ được chọn.
-- Không CONCURRENTLY vì migration chạy trong transaction: khoá chặn ghi notification_logs lúc dựng (ghi log tin của mọi kênh).
CREATE INDEX IF NOT EXISTS "notification_logs_userId_channel_sentAt_id_idx"
  ON "notification_logs" ("userId", "channel", "sentAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "notification_logs_userId_channel_status_idx"
  ON "notification_logs" ("userId", "channel", "status");
