-- Tin "câu trả lời hay nhất" chỉ nhắc Điểm Xanh khi điểm đã vào sổ: phần thưởng do mã điền qua {{reward_note}} (rỗng khi chạm trần ngày, thưởng 0 hoặc lỗi cấp).
-- Chỉ đổi khi nội dung vẫn đúng bản cũ, để không đè bản admin đã sửa. Idempotent (chạy lại: không còn dòng khớp).
UPDATE "notification_templates" SET "bodyTemplate" = 'Câu trả lời của bạn được chọn là hay nhất! 🌿{{reward_note}}'
WHERE "code" = 'COMMUNITY_BEST_ANSWER'
  AND "bodyTemplate" = 'Câu trả lời của bạn được chọn là hay nhất! 🌿 Bạn nhận thêm Điểm Xanh thưởng.';
