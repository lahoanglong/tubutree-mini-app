-- Đợt 8 (chữ khách đọc, DESIGN.md: không "Vui lòng"): 4 mẫu tin chờ thanh toán / tạm dừng định kỳ còn "Vui lòng".
-- Chỉ đổi khi nội dung vẫn đúng bản mặc định cũ, để không đè bản admin đã sửa. Idempotent (chạy lại: không còn dòng khớp).
-- Mẫu chưa có trên DB thì không có dòng nào để đổi. Lời mới trùng từng chữ với prisma/seed.ts.

UPDATE "notification_templates" SET "bodyTemplate" = 'Đơn {{order_code}} đang chờ thanh toán {{amount}}. Bạn thanh toán trước {{deadline}} nhé, quá hạn đơn sẽ tự huỷ.'
WHERE "code" = 'ORDER_AWAITING_PAYMENT'
  AND "bodyTemplate" = 'Đơn {{order_code}} đang chờ thanh toán {{amount}}. Vui lòng thanh toán trước {{deadline}}, quá hạn đơn sẽ tự huỷ.';

UPDATE "notification_templates" SET "bodyTemplate" = 'Tubu đã nhận {{paid}} cho đơn {{order_code}}, còn thiếu {{missing}} (tổng {{total}}). Bạn chuyển thêm phần còn thiếu với nội dung {{order_code}} nhé. Nếu đơn bị huỷ, Tubu sẽ hoàn lại số tiền đã nhận.'
WHERE "code" = 'ORDER_UNDERPAID'
  AND "bodyTemplate" = 'Tubu đã nhận {{paid}} cho đơn {{order_code}}, còn thiếu {{missing}} (tổng {{total}}). Vui lòng chuyển thêm phần còn thiếu với nội dung {{order_code}}. Nếu đơn bị huỷ, Tubu sẽ hoàn lại số tiền đã nhận.';

UPDATE "notification_templates" SET "bodyTemplate" = 'Lịch đặt định kỳ đã tạm dừng: {{reason}}. Bạn kiểm tra lại rồi bật lại lịch nhé 🌿'
WHERE "code" = 'SUBSCRIPTION_PAUSED'
  AND "bodyTemplate" = 'Lịch đặt định kỳ đã tạm dừng: {{reason}}. Vui lòng kiểm tra lại rồi bật lại lịch nhé 🌿';

UPDATE "notification_templates" SET "bodyTemplate" = 'Đơn định kỳ {{order_code}} đã được tạo. Bạn chuyển khoản {{amount}}đ trong {{hours}} giờ để Tubu giao hàng nhé. Quá hạn đơn kỳ này sẽ tự huỷ, lịch vẫn giữ cho kỳ sau 🌿'
WHERE "code" = 'SUBSCRIPTION_ORDER_AWAITING_PAYMENT'
  AND "bodyTemplate" = 'Đơn định kỳ {{order_code}} đã được tạo, vui lòng chuyển khoản {{amount}}đ trong {{hours}} giờ để Tubu giao hàng. Quá hạn đơn kỳ này sẽ tự huỷ, lịch vẫn giữ cho kỳ sau 🌿';
