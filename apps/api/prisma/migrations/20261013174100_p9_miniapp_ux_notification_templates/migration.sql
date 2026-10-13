-- P9 miniapp UX: mẫu thông báo mới (prod không chạy seed). Chỉ THÊM; DO NOTHING bỏ qua cả trùng id lẫn trùng code
-- nên không ghi đè bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-comm-rejected', 'COMMUNITY_POST_REJECTED', 'INAPP', '🌿 Bài viết "{{title}}" của bạn chưa được đăng vì {{reason}}. Bạn có thể chỉnh lại nội dung rồi đăng bài mới nhé.')
ON CONFLICT DO NOTHING;

-- Tin "đơn định kỳ chưa đặt được" từng hứa cứng "thử lại kỳ sau"; cron giờ thử lại từng đêm nên câu hứa nằm trong {{retry}}.
-- Chỉ đổi bản còn NGUYÊN VĂN mặc định, không đè bản admin đã sửa.
UPDATE "notification_templates"
SET "bodyTemplate" = 'Đơn định kỳ kỳ này chưa đặt được: {{reason}}. {{retry}} 🌿'
WHERE "code" = 'SUBSCRIPTION_ORDER_FAILED'
  AND "bodyTemplate" = 'Đơn định kỳ kỳ này chưa đặt được: {{reason}}. Lịch vẫn giữ, Tubu sẽ thử lại kỳ sau 🌿';
