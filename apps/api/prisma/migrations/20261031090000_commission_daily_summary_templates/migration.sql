-- Hoa hồng đã duyệt được chuyển vào Ví một lần mỗi ngày từ 8:00, mỗi CTV một tin tổng: tin nêu thêm số đơn, tin "đã duyệt" dặn việc cần làm.
-- Chỉ đổi khi còn đúng bản cũ (admin đã chỉnh chữ thì giữ).
UPDATE "notification_templates"
SET "bodyTemplate" = '💰 Tubu Tree đã chuyển {{amount}} hoa hồng ({{count}} đơn) vào Ví của bạn{{tax_note}}. Bạn dùng được ngay khi thanh toán.'
WHERE "code" = 'COMMISSION_WALLET_CREDITED'
  AND "channel" = 'INAPP'
  AND "bodyTemplate" = '💰 Đã cộng {{amount}} hoa hồng vào Ví Tubu{{tax_note}}. Bạn dùng được ngay khi thanh toán đơn hàng.';

UPDATE "notification_templates"
SET "bodyTemplate" = '✅ Tubu Tree đã duyệt hoa hồng của {{count}} đơn (tổng {{amount}}). Bạn vào mục Hoa hồng, bấm Chuyển vào Ví để nhận tiền nhé.'
WHERE "code" = 'COMMISSION_APPROVED'
  AND "channel" = 'INAPP'
  AND "bodyTemplate" = '✅ {{count}} khoản hoa hồng (tổng {{amount}}) đã được duyệt. Khoản này chưa tự vào Ví, bạn chuyển vào Ví Tubu ngay trong mục CTV nhé.';
