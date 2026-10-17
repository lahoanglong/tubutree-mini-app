-- Launch review (cộng đồng): mẫu tin báo tác giả khi bài có người thích/bình luận và khi bài bị ẩn (prod không chạy seed),
-- cùng hai khoá cấu hình mới. Chỉ THÊM; DO NOTHING bỏ qua cả trùng id lẫn trùng code/khoá nên không ghi đè bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-comm-post-liked', 'COMMUNITY_POST_LIKED', 'INAPP', '💚 Bài viết "{{title}}" của bạn vừa được thả tim.'),
  ('nt-comm-post-commented', 'COMMUNITY_POST_COMMENTED', 'INAPP', '💬 {{author}} vừa bình luận bài viết "{{title}}" của bạn.'),
  ('nt-comm-post-hidden', 'COMMUNITY_POST_HIDDEN', 'INAPP', '🌿 Bài viết "{{title}}" của bạn đã được ẩn khỏi cộng đồng vì {{reason}}. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.')
ON CONFLICT DO NOTHING;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('community.author_notify_interval_minutes', to_jsonb(60), 'Gộp tin "bài của bạn có người thích/bình luận": tối đa 1 tin mỗi bài trong chừng này phút (0 = tắt tin)', 'community', now()),
  ('community.unanswered_alert_hours', to_jsonb(24), 'Câu hỏi cộng đồng chưa ai trả lời quá chừng này giờ thì hiện ở "Việc cần xử lý" của CSKH', 'community', now())
ON CONFLICT ("key") DO NOTHING;
