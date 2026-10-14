-- R6 partner: mẫu thông báo cho phiếu đối soát âm (gian hàng nộp lại Tubu) và cho phiếu bị huỷ (prod không chạy seed). Chỉ THÊM mẫu
-- mới (DO NOTHING bỏ qua cả trùng id lẫn trùng code, không ghi đè bản admin đã sửa).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-merchant-payout-created-to-tubu', 'MERCHANT_PAYOUT_CREATED_TO_TUBU', 'INAPP', 'Tubu Tree đã lập phiếu đối soát cho {{count}} đơn của gian hàng: bạn cần chuyển cho Tubu Tree {{amount}}đ trước {{due_date}}, nội dung chuyển khoản "{{memo}}". Xem tài khoản nhận và các khoản trong phiếu ở Cổng người bán → Đối soát.'),
  ('nt-merchant-payout-cancelled', 'MERCHANT_PAYOUT_CANCELLED', 'INAPP', 'Tubu Tree đã huỷ phiếu đối soát {{amount}}đ lập ngày {{created}}: {{reason}}. Các đơn trong phiếu quay lại bảng kê và sẽ vào phiếu mới; xem lại các khoản của phiếu đã huỷ ở Cổng người bán → Đối soát.'),
  ('nt-merchant-payout-cancelled-to-tubu', 'MERCHANT_PAYOUT_CANCELLED_TO_TUBU', 'INAPP', 'Tubu Tree đã huỷ phiếu đối soát lập ngày {{created}} (bạn phải nộp {{amount}}đ): {{reason}}. Bạn chưa cần chuyển khoản cho phiếu này; nếu đã chuyển, liên hệ Tubu Tree để đối chiếu. Các đơn trong phiếu quay lại bảng kê và sẽ vào phiếu mới.')
ON CONFLICT DO NOTHING;
