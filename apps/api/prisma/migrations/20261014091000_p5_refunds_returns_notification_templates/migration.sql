-- P5 (D2/D3): prod không chạy `prisma db seed`, nên mẫu tin mới phải đi bằng migration. Cùng nội dung với
-- prisma/seed.ts (notification-templates-seed.spec.ts đối chiếu).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-order-awaiting-payment', 'ORDER_AWAITING_PAYMENT', 'INAPP', 'Đơn {{order_code}} đang chờ thanh toán {{amount}}. Vui lòng thanh toán trước {{deadline}}, quá hạn đơn sẽ tự huỷ.'),
  ('nt-order-payment-expired', 'ORDER_PAYMENT_EXPIRED', 'INAPP', 'Đơn {{order_code}} đã tự huỷ vì quá hạn thanh toán. Nếu bạn đã chuyển khoản, Tubu sẽ tạo yêu cầu hoàn tiền và báo bạn. Bạn có thể đặt lại trong mục Đơn hàng.'),
  ('nt-return-ok-detail', 'RETURN_APPROVED_DETAIL', 'INAPP', 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt.{{refund_note}}'),
  ('nt-return-rejected', 'RETURN_REJECTED', 'INAPP', 'Yêu cầu đổi/trả đơn {{order_code}} chưa được chấp nhận. Lý do: "{{reason}}". Liên hệ Tubu qua Zalo OA nếu bạn cần hỗ trợ thêm.'),
  ('nt-return-received', 'RETURN_RECEIVED', 'INAPP', 'Tubu đã nhận lại hàng trả của đơn {{order_code}}. Cảm ơn bạn 🌿'),
  ('nt-refund-bank-requested', 'REFUND_BANK_REQUESTED', 'INAPP', 'Tubu đã ghi nhận hoàn {{amount}} của đơn {{order_code}} về tài khoản {{bank}}. Tiền sẽ được chuyển trong 1-3 ngày làm việc, miễn phí.'),
  ('nt-refund-bank-completed', 'REFUND_BANK_COMPLETED', 'INAPP', 'Tubu đã chuyển khoản hoàn {{amount}} của đơn {{order_code}} về tài khoản {{bank}} (mã giao dịch {{bank_ref}}) 🌿'),
  ('nt-refund-late-payment', 'REFUND_LATE_PAYMENT', 'INAPP', 'Tubu đã nhận {{amount}} cho đơn {{order_code}} nhưng đơn đã huỷ. Vào chi tiết đơn để chọn nhận tiền hoàn về Ví Tubu (ngay) hoặc tài khoản ngân hàng (1-3 ngày làm việc, miễn phí).'),
  ('nt-refund-wallet-credited', 'REFUND_WALLET_CREDITED', 'INAPP', 'Đã hoàn {{amount}} của đơn {{order_code}} vào Ví Tubu 🌿'),
  ('nt-ops-refund', 'OPS_REFUND_ALERT', 'INAPP', '💸 Hoàn tiền đơn {{order_code}}: {{message}}')
ON CONFLICT DO NOTHING;

-- Tin huỷ đơn nói rõ tiền hoàn bao nhiêu, về đâu (BUYERMINI-9). Chỉ thay khi vẫn là câu seed cũ.
UPDATE "notification_templates" SET "bodyTemplate" = 'Đơn {{order_code}} đã bị hủy.{{refund_note}}'
  WHERE "code" = 'ORDER_CANCELLED'
    AND "bodyTemplate" = 'Đơn {{order_code}} đã bị hủy.';
