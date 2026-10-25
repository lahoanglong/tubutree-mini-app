-- Rút hoa hồng về ngân hàng đã bỏ (chính sách Zalo 4.5): hoa hồng chỉ chuyển vào Ví Tubu, nên tin COMMISSION_APPROVED không còn hứa "rút".
-- Chỉ đổi khi nội dung vẫn đúng bản seed cũ, để không đè bản admin đã sửa. Idempotent (chạy lại: không còn dòng khớp).
UPDATE "notification_templates" SET "bodyTemplate" = '✅ {{count}} khoản hoa hồng (tổng {{amount}}) đã được duyệt. Bạn có thể chuyển vào Ví Tubu ngay trong mục CTV.'
WHERE "code" = 'COMMISSION_APPROVED'
  AND "bodyTemplate" = '✅ {{count}} khoản hoa hồng (tổng {{amount}}) đã được duyệt. Bạn có thể rút ngay trong mục CTV.';
