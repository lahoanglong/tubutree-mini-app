-- Q7 engage: mẫu thông báo mới (prod không chạy seed). Chỉ THÊM; DO NOTHING bỏ qua cả trùng id lẫn trùng code
-- nên không ghi đè bản admin đã sửa.
-- GROUP_BUY_FAILED: nhóm mua chung hết hạn không đủ người (trước đây chuyển FAILED trong im lặng).
-- COMMUNITY_EVENT_WINNER: báo người thắng sự kiện cộng đồng (trước đây chỉ cộng điểm im lặng).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-groupbuy-failed', 'GROUP_BUY_FAILED', 'INAPP', 'Nhóm mua chung "{{product}}" chưa đủ người trước hạn nên đã đóng. Bạn vẫn mua được với giá thường hoặc mở nhóm mới để rủ thêm bạn bè nhé 🌿'),
  ('nt-comm-event-winner', 'COMMUNITY_EVENT_WINNER', 'INAPP', '🏆 Chúc mừng! Bạn là người thắng sự kiện "{{title}}" của cộng đồng Tubu.{{reward}}')
ON CONFLICT DO NOTHING;
