-- Mã mua chung nay là mã % có trần, nên tin GROUP_BUY_SUCCESS không còn hứa số tiền cố định: {{discount}} giờ là "15%".
-- Chỉ đổi khi nội dung vẫn đúng bản cũ, để không đè bản admin đã sửa. Idempotent (chạy lại: không còn dòng khớp).
UPDATE "notification_templates" SET "bodyTemplate" = '🎉 Nhóm mua chung đã đủ người! Bạn nhận mã giảm {{discount}} để mua với giá nhóm. Đặt hàng ngay nhé 🛒'
WHERE "code" = 'GROUP_BUY_SUCCESS'
  AND "bodyTemplate" = '🎉 Nhóm mua chung đã đủ người! Bạn nhận mã giảm {{discount}}đ để mua với giá nhóm. Đặt hàng ngay nhé 🛒';
