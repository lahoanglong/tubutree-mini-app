-- chatpts (B9 bước 3): bảng claim đã có kind PHONE, state HELD_NO_MEMBER/LAPSED, holdUntil và countsForTier từ 20261019100000_external_orders
-- nên không đổi schema. Chỉ THÊM mẫu thông báo INAPP của điểm đơn chat/điện thoại (prod không chạy seed) và dòng cấu hình tỉ lệ để null.
-- DO NOTHING bỏ qua trùng id lẫn trùng code, không ghi đè bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-chat-order-points-credited', 'CHAT_ORDER_POINTS_CREDITED', 'INAPP', 'Bạn nhận {{points}} Điểm Xanh từ đơn đặt qua tư vấn viên Tubu Tree. Cảm ơn bạn đã mua sắm cùng Tubu Tree 🌿'),
  ('nt-chat-order-points-linked', 'CHAT_ORDER_POINTS_LINKED', 'INAPP', 'Tubu Tree đang giữ {{points}} Điểm Xanh cho bạn từ {{count}} đơn đặt qua tư vấn viên. Điểm được cộng sau khi đơn giao thành công và hết thời gian giữ điểm 🌿')
ON CONFLICT DO NOTHING;

-- Tỉ lệ tích đơn chat: null = dùng loyalty.earn_pct (tỉ lệ đơn trong app). Tạo dòng để chủ shop thấy và đặt riêng ở tab Cấu hình.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('loyalty.chat_order_earn_pct', 'null'::jsonb, 'Tỉ lệ Điểm Xanh (phần trăm tiền hàng, 2 = 2%) cho đơn chat/điện thoại, nhân hệ số hạng của thành viên. Để null thì dùng loyalty.earn_pct (tỉ lệ đơn trong app)', 'loyalty', now())
ON CONFLICT DO NOTHING;
