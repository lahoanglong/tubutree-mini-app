-- PD-3 review B1: duyệt trả hàng phải báo khách ĐÚNG thứ đã hoàn. Đơn XU cũ và phần điểm quy đổi được hoàn bằng
-- Điểm Xanh (không vào Ví), nên mẫu "Tiền đã hoàn vào Ví Tubu" sai còn mẫu trung tính thì thiếu số điểm.
-- Chỉ THÊM hai mẫu mới (prod không chạy seed). DO NOTHING bỏ qua cả trùng id lẫn trùng code, không ghi đè bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-return-ok-points', 'RETURN_APPROVED_POINTS', 'INAPP', 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt. Đã hoàn {{points}} Điểm Xanh vào tài khoản của bạn 🌿'),
  ('nt-return-ok-wallet-points', 'RETURN_APPROVED_WALLET_POINTS', 'INAPP', 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt. Tiền đã hoàn vào Ví Tubu và {{points}} Điểm Xanh đã hoàn vào tài khoản của bạn 🌿')
ON CONFLICT DO NOTHING;
