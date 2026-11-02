-- R-112: bỏ emoji trong thân mẫu tin cộng đồng (COMMUNITY_*). Chỉ đổi khi nội dung vẫn đúng bản mặc định cũ,
-- để không đè bản admin đã sửa. Idempotent (chạy lại: không còn dòng khớp). Mẫu chưa có trên DB thì không có dòng nào để đổi.

UPDATE "notification_templates" SET "bodyTemplate" = 'Chúc mừng! Bạn là người thắng sự kiện "{{title}}" của cộng đồng Tubu.{{reward}}'
WHERE "code" = 'COMMUNITY_EVENT_WINNER'
  AND "bodyTemplate" = '🏆 Chúc mừng! Bạn là người thắng sự kiện "{{title}}" của cộng đồng Tubu.{{reward}}';

UPDATE "notification_templates" SET "bodyTemplate" = '{{author}} vừa trả lời câu hỏi "{{title}}" của bạn.'
WHERE "code" = 'COMMUNITY_NEW_ANSWER'
  AND "bodyTemplate" = '💬 {{author}} vừa trả lời câu hỏi "{{title}}" của bạn.';

UPDATE "notification_templates" SET "bodyTemplate" = 'Chuyên gia Tubu vừa trả lời câu hỏi "{{title}}" của bạn.'
WHERE "code" = 'COMMUNITY_EXPERT_REPLIED'
  AND "bodyTemplate" = '🌿 Chuyên gia Tubu vừa trả lời câu hỏi "{{title}}" của bạn.';

UPDATE "notification_templates" SET "bodyTemplate" = 'Câu trả lời của bạn được chọn là hay nhất!{{reward_note}}'
WHERE "code" = 'COMMUNITY_BEST_ANSWER'
  AND "bodyTemplate" = 'Câu trả lời của bạn được chọn là hay nhất! 🌿{{reward_note}}';

UPDATE "notification_templates" SET "bodyTemplate" = 'Bài viết của bạn đã được duyệt và hiển thị trong cộng đồng.'
WHERE "code" = 'COMMUNITY_POST_APPROVED'
  AND "bodyTemplate" = '🌱 Bài viết của bạn đã được duyệt và hiển thị trong cộng đồng.';

UPDATE "notification_templates" SET "bodyTemplate" = 'Bài viết "{{title}}" của bạn chưa được đăng vì {{reason}}. Bạn có thể chỉnh lại nội dung rồi đăng bài mới nhé.'
WHERE "code" = 'COMMUNITY_POST_REJECTED'
  AND "bodyTemplate" = '🌿 Bài viết "{{title}}" của bạn chưa được đăng vì {{reason}}. Bạn có thể chỉnh lại nội dung rồi đăng bài mới nhé.';

UPDATE "notification_templates" SET "bodyTemplate" = 'Bài viết "{{title}}" của bạn vừa được thả tim.'
WHERE "code" = 'COMMUNITY_POST_LIKED'
  AND "bodyTemplate" = '💚 Bài viết "{{title}}" của bạn vừa được thả tim.';

UPDATE "notification_templates" SET "bodyTemplate" = '{{author}} vừa bình luận bài viết "{{title}}" của bạn.'
WHERE "code" = 'COMMUNITY_POST_COMMENTED'
  AND "bodyTemplate" = '💬 {{author}} vừa bình luận bài viết "{{title}}" của bạn.';

UPDATE "notification_templates" SET "bodyTemplate" = 'Bài viết "{{title}}" của bạn đã được ẩn khỏi cộng đồng vì {{reason}}. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.'
WHERE "code" = 'COMMUNITY_POST_HIDDEN'
  AND "bodyTemplate" = '🌿 Bài viết "{{title}}" của bạn đã được ẩn khỏi cộng đồng vì {{reason}}. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.';
