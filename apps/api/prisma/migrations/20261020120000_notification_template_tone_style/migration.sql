-- Thống nhất kiểu đặt dấu "huỷ" trong mẫu tin đơn bị huỷ (prod không chạy seed). Chỉ sửa khi mẫu còn đúng bản gốc,
-- không đè bản admin đã chỉnh.
UPDATE "notification_templates"
   SET "bodyTemplate" = 'Đơn {{order_code}} đã bị huỷ.{{refund_note}}'
 WHERE "code" = 'ORDER_CANCELLED' AND "channel" = 'INAPP'
   AND "bodyTemplate" = 'Đơn {{order_code}} đã bị hủy.{{refund_note}}';
