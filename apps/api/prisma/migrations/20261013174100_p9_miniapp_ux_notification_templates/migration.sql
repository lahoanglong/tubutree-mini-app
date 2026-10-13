-- P9 miniapp UX: mẫu thông báo mới (prod không chạy seed). Chỉ THÊM; DO NOTHING bỏ qua cả trùng id lẫn trùng code
-- nên không ghi đè bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-comm-rejected', 'COMMUNITY_POST_REJECTED', 'INAPP', '🌿 Bài viết "{{title}}" của bạn chưa được đăng vì {{reason}}. Bạn có thể chỉnh lại nội dung rồi đăng bài mới nhé.')
ON CONFLICT DO NOTHING;
