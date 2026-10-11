-- PD-3 review B1 (Q-26): hai mẫu tin còn nhắc TubuXu dù đổi Ví → xu đã trả 410 và xu đã gộp vào Điểm Xanh.
-- Chỉ đổi khi nội dung vẫn đúng bản seed cũ, để không đè bản admin đã sửa. Idempotent (chạy lại: không còn dòng khớp).
UPDATE "notification_templates" SET "bodyTemplate" = 'Hoàn tiền {{amount}}đ từ mua sắm sàn ngoài đã vào Ví Tubu 🌿'
WHERE "code" = 'CASHBACK_PAID'
  AND "bodyTemplate" = 'Hoàn tiền {{amount}}đ từ mua sắm sàn ngoài đã vào Ví Tubu 🌿 Đổi sang TubuXu để nhận thêm 20% nhé!';

UPDATE "notification_templates" SET "bodyTemplate" = 'Câu trả lời của bạn được chọn là hay nhất! 🌿 Bạn nhận thêm Điểm Xanh thưởng.'
WHERE "code" = 'COMMUNITY_BEST_ANSWER'
  AND "bodyTemplate" = 'Câu trả lời của bạn được chọn là hay nhất! 🌿 Bạn nhận thêm TubuXu thưởng.';
