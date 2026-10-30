-- Tin báo thu hồi hoa hồng nay cũng gửi khi hoa hồng đã vào Ví Tubu và Ví bị trừ thẳng (có khi âm): bỏ chữ "dự kiến" để CTV không
-- tưởng chỉ mất khoản đang chờ. Chỉ đổi khi còn đúng bản seed cũ (admin đã chỉnh chữ thì giữ).
UPDATE "notification_templates"
SET "bodyTemplate" = 'Khoản hoa hồng {{amount}} đã bị thu hồi vì đơn của khách bị huỷ hoặc trả hàng. Nếu khoản này đã vào Ví Tubu, Ví đã bị trừ tương ứng.'
WHERE "code" = 'COMMISSION_REVERSED'
  AND "channel" = 'INAPP'
  AND "bodyTemplate" = 'Khoản hoa hồng dự kiến {{amount}} đã bị thu hồi vì đơn của khách bị huỷ hoặc trả hàng.';
