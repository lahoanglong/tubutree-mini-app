-- R12: mẫu tin báo người mời khi thưởng giới thiệu được cấp, thưởng mốc được cấp, hoặc thưởng bị thu lại (prod không chạy
-- seed). Chỉ THÊM mẫu mới (DO NOTHING bỏ qua cả trùng id lẫn trùng code, không ghi đè bản admin đã sửa).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-referral-reward-paid', 'REFERRAL_REWARD_PAID', 'INAPP', 'Bạn nhận {{points}} Điểm Xanh vì {{friend}} đã mua đơn thứ hai. Cảm ơn bạn đã giới thiệu Tubu Tree 🌿'),
  ('nt-referral-milestone-paid', 'REFERRAL_MILESTONE_PAID', 'INAPP', 'Bạn đã giới thiệu thành công {{count}} người bạn và nhận thêm {{points}} Điểm Xanh thưởng mốc 🌿'),
  ('nt-referral-reward-revoked', 'REFERRAL_REWARD_REVOKED', 'INAPP', 'Thưởng giới thiệu từ {{friend}} được thu lại vì {{cause}}: {{detail}}.')
ON CONFLICT DO NOTHING;
