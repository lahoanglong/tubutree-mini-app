-- extclaim (B6 bước 2): bảng claim/attempt và unique sổ điểm đã có từ 20261019100000_external_orders nên không đổi schema.
-- Chỉ THÊM mẫu thông báo INAPP của điểm đơn ngoài app (prod không chạy seed). DO NOTHING bỏ qua trùng id lẫn trùng code, không ghi đè
-- bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-external-points-pending', 'EXTERNAL_POINTS_PENDING', 'INAPP', 'Tubu Tree đã ghi nhận {{points}} Điểm Xanh chờ cộng cho đơn {{code}}. Điểm được cộng sau khi đơn giao thành công và hết thời gian giữ điểm 🌿'),
  ('nt-external-points-credited', 'EXTERNAL_POINTS_CREDITED', 'INAPP', 'Bạn nhận {{points}} Điểm Xanh từ đơn {{code}} mua ngoài app. Cảm ơn bạn đã ủng hộ Tubu Tree 🌿'),
  ('nt-external-points-voided', 'EXTERNAL_POINTS_VOIDED', 'INAPP', 'Điểm từ đơn {{code}} không được tích: {{detail}}.'),
  ('nt-external-points-claim-not-found', 'EXTERNAL_POINTS_CLAIM_NOT_FOUND', 'INAPP', 'Tubu Tree chưa tích được điểm cho mã {{code}}: {{detail}}. Bạn có thể kiểm tra lại mã hoặc liên hệ hỗ trợ.')
ON CONFLICT DO NOTHING;

-- Mốc bắt đầu tích điểm đơn sàn: tạo dòng với giá trị null (= chỉ áp tuổi đơn tối đa) để chủ shop thấy và đặt ngày ở tab Cấu hình.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('loyalty.external_since', 'null'::jsonb, 'Đơn Pancake ngoài app tạo trước mốc này (YYYY-MM-DD) không được tích điểm. Để null thì chỉ áp loyalty.marketplace_claim_max_age_days', 'loyalty', now())
ON CONFLICT DO NOTHING;
