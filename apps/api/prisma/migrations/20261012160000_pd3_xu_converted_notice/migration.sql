-- PD-3 L5 (OQ-10, Q-03a): báo khách có xu đã được quy sang Điểm Xanh. Chỉ THÊM, không UPDATE/DELETE dữ liệu cũ.
-- (1) Mẫu tin XU_CONVERTED (prod không chạy seed). DO NOTHING bỏ qua cả trùng id lẫn trùng code nên không đè bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-xu-converted', 'XU_CONVERTED', 'INAPP', '{{xu}} xu cũ của bạn đã thành {{points}} Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng.')
ON CONFLICT DO NOTHING;

-- (2) Mỗi user ở bảng chụp xu_points_conversions (migration B) một thông báo trong app. id cố định theo user và
-- NOT EXISTS theo (userId, templateCode): chạy lại, hoặc B chạy lại cho user mới, không báo hai lần và không đè
-- trạng thái đã đọc. Lời tin dựng từ mẫu đang có bằng đúng phép thay {{biến}} của NotificationsService.render;
-- số xu có dấu chấm ngăn nghìn (to_char dùng dấu phẩy cố định, không phụ thuộc locale của DB).
INSERT INTO "notification_logs" ("id", "userId", "templateCode", "channel", "payload", "status", "sentAt")
SELECT 'nlog_xu2pts_' || x."userId", x."userId", 'XU_CONVERTED', 'INAPP',
       jsonb_build_object(
         'body', replace(replace(t."bodyTemplate", '{{xu}}', replace(to_char(x."coinsBefore", 'FM999,999,999,999'), ',', '.')),
                         '{{points}}', x."pointsGranted"::text),
         'data', jsonb_build_object('xu', replace(to_char(x."coinsBefore", 'FM999,999,999,999'), ',', '.'),
                                    'points', x."pointsGranted"::text)),
       'SENT', CURRENT_TIMESTAMP
  FROM "xu_points_conversions" x
  JOIN "notification_templates" t ON t."code" = 'XU_CONVERTED'
 WHERE NOT EXISTS (SELECT 1 FROM "notification_logs" l WHERE l."userId" = x."userId" AND l."templateCode" = 'XU_CONVERTED')
ON CONFLICT ("id") DO NOTHING;
