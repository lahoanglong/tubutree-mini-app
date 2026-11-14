-- W156: thông báo "đã ghi nhận thanh toán" cho đại lý khi lần thu tiền có kèm chiết khấu thanh toán (W154, xoá nợ vào TK 635).
-- Mẫu mới, không đổi mẫu nào đã có (DEALER_CREDIT_PAYMENT_CONFIRMED giữ nguyên cho lần thu không chiết khấu). Không đổi schema.
-- DO NOTHING (không đích cụ thể) bỏ qua cả trùng id lẫn trùng code, nên bản admin đã tạo trước đó không bị đè. Idempotent.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-dealer-credit-confirmed-discount', 'DEALER_CREDIT_PAYMENT_CONFIRMED_DISCOUNT', 'INAPP', '✅ Tubu Tree đã xác nhận nhận {{amount}}đ tiền thực thu trả nợ của bạn, kèm {{discount}}đ chiết khấu thanh toán được xoá nợ. Tổng công nợ giảm {{cleared}}đ. Cảm ơn bạn 🌿')
ON CONFLICT DO NOTHING;
