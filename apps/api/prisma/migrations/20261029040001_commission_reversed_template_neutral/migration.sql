-- Tin báo thu hồi hoa hồng nay cũng gửi khi hoa hồng đã vào Ví Tubu và Ví bị trừ thẳng (có khi âm): bỏ chữ "dự kiến" để CTV không
-- tưởng chỉ mất khoản đang chờ. {{amount}} là số gộp, Ví chỉ bị trừ phần thực nhận sau thuế nên tin không nêu số đã trừ Ví.
-- Chỉ đổi khi còn đúng bản seed cũ (admin đã chỉnh chữ thì giữ).
UPDATE "notification_templates"
SET "bodyTemplate" = 'Khoản hoa hồng {{amount}} đã bị thu hồi vì đơn của khách bị huỷ hoặc trả hàng. Phần đã vào Ví Tubu (nếu có) đã được trừ, xem chi tiết ở lịch sử Ví.'
WHERE "code" = 'COMMISSION_REVERSED'
  AND "channel" = 'INAPP'
  AND "bodyTemplate" = 'Khoản hoa hồng dự kiến {{amount}} đã bị thu hồi vì đơn của khách bị huỷ hoặc trả hàng.';
