-- Tin ORDER_CONFIRMED của đơn đã trả trước (chuyển khoản, ZaloPay, Ví) nói thêm "Tubu Tree đã nhận đủ thanh toán" qua {{payment_note}};
-- đơn COD để biến rỗng nên chữ giữ nguyên. Chỉ đổi khi còn đúng bản seed cũ (admin đã chỉnh chữ thì giữ).
UPDATE "notification_templates"
SET "bodyTemplate" = 'Đơn {{order_code}} đã được xác nhận.{{payment_note}} Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿'
WHERE "code" = 'ORDER_CONFIRMED'
  AND "bodyTemplate" = 'Đơn {{order_code}} đã được xác nhận. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿';
