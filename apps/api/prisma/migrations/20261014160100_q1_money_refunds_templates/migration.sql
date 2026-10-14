-- Q1: prod không chạy `prisma db seed`, nên mẫu tin mới đi bằng migration. Cùng nội dung với prisma/seed.ts
-- (notification-templates-seed.spec.ts đối chiếu).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ops-payment', 'OPS_PAYMENT_ALERT', 'INAPP', '⚠️ Thanh toán đơn {{order_code}}: {{message}}'),
  ('nt-order-underpaid', 'ORDER_UNDERPAID', 'INAPP', 'Tubu đã nhận {{paid}} cho đơn {{order_code}}, còn thiếu {{missing}} (tổng {{total}}). Vui lòng chuyển thêm phần còn thiếu với nội dung {{order_code}}. Nếu đơn bị huỷ, Tubu sẽ hoàn lại số tiền đã nhận.')
ON CONFLICT DO NOTHING;

-- Tin đơn trả hàng nói rõ tiền hoàn bao nhiêu, về đâu (R2-LIFECYCLE-5). Chỉ thay khi vẫn là câu seed cũ.
UPDATE "notification_templates" SET "bodyTemplate" = 'Đơn {{order_code}} đã được hoàn trả.{{refund_note}}'
  WHERE "code" = 'ORDER_RETURNED'
    AND "bodyTemplate" = 'Đơn {{order_code}} đã được hoàn trả.';
