-- C-015/C-017 (review lượt 1): prod không chạy `prisma db seed`, nên mẫu tin mới hoặc đổi lời của gói định kỳ phải
-- đi bằng migration. Cùng nội dung với prisma/seed.ts (notification-templates-seed.spec.ts đối chiếu).

-- Gói trả bằng chuyển khoản: thiếu mẫu này khách nhận câu mặc định, không biết số tiền và hạn chuyển khoản.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-sub-order-awaiting-payment', 'SUBSCRIPTION_ORDER_AWAITING_PAYMENT', 'INAPP', 'Đơn định kỳ {{order_code}} đã được tạo, vui lòng chuyển khoản {{amount}}đ trong {{hours}} giờ để Tubu giao hàng. Quá hạn đơn kỳ này sẽ tự huỷ, lịch vẫn giữ cho kỳ sau 🌿'),
  ('nt-sub-pause', 'SUBSCRIPTION_PAUSED', 'INAPP', 'Lịch đặt định kỳ đã tạm dừng: {{reason}}. Vui lòng kiểm tra lại rồi bật lại lịch nhé 🌿')
ON CONFLICT DO NOTHING;

-- Lời cũ của SUBSCRIPTION_PAUSED đoán sai lý do (luôn nói "hết hàng hoặc địa chỉ") và bỏ qua {{reason}}. Chỉ thay khi
-- vẫn là đúng câu seed cũ, để không ghi đè nội dung admin đã tự chỉnh.
UPDATE "notification_templates" SET "bodyTemplate" = 'Lịch đặt định kỳ đã tạm dừng: {{reason}}. Vui lòng kiểm tra lại rồi bật lại lịch nhé 🌿'
  WHERE "code" = 'SUBSCRIPTION_PAUSED'
    AND "bodyTemplate" = 'Lịch đặt định kỳ tạm dừng (sản phẩm hết hàng hoặc địa chỉ không hợp lệ). Vui lòng kiểm tra lại.';

-- Lời của migration 20261010190500 lặp "cho đơn" khi mã có đơn tối thiểu ("giảm 30.000đ cho đơn từ 199.000đ cho đơn
-- tiếp theo"). Cùng điều kiện "chỉ thay câu cũ".
UPDATE "notification_templates" SET "bodyTemplate" = 'Cảm ơn bạn đã tin dùng Tubu Tree! Tặng mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}}, dùng cho lần mua tiếp theo trước {{expires}} 🌿'
  WHERE "code" = 'SECOND_ORDER_VOUCHER'
    AND "bodyTemplate" = 'Cảm ơn bạn đã tin dùng Tubu Tree! Tặng mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}} cho đơn tiếp theo, dùng trước {{expires}} 🌿';
