-- Hộp tin in-app của khách (NotificationFeedService.list / listForUser: userId + channel = 'INAPP' ORDER BY sentAt DESC, id DESC)
-- và số chưa đọc (unreadCount, markAllRead: INAPP và status <> 'READ'). Index (userId, sentAt) hiện có lẫn cả tin ZNS của khách,
-- nên phải lọc channel từng dòng rồi sắp lại theo (sentAt, id). Index một phần chỉ chứa INAPP, đã đúng thứ tự trả về.
-- Chỉ SQL (Prisma không biểu diễn được index một phần). Không CONCURRENTLY vì migration chạy trong transaction:
-- khoá chặn ghi notification_logs lúc dựng (ghi log tin của mọi kênh).
CREATE INDEX IF NOT EXISTS "notification_logs_inapp_feed_idx"
  ON "notification_logs" ("userId", "sentAt" DESC, "id" DESC) WHERE "channel" = 'INAPP';

CREATE INDEX IF NOT EXISTS "notification_logs_inapp_unread_idx"
  ON "notification_logs" ("userId") WHERE "channel" = 'INAPP' AND "status" <> 'READ';
