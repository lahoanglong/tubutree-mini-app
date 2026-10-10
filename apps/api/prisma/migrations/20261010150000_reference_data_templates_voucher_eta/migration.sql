-- C-053 + C-054: dữ liệu tham chiếu mà prod KHÔNG nhận được vì prod không chạy `prisma db seed` (và chạy lại cả seed
-- trên prod có dữ liệu thật sẽ ghi đè giá sản phẩm/hạng — xem docs/2026-09-27-wip-completion-deploy-notes.md mục 5.3).
-- Không đổi schema. Mọi câu đều idempotent và KHÔNG ghi đè nội dung/giá trị admin đã chỉnh.

-- 1) Tám mẫu thông báo code gọi nhưng DB thiếu: thiếu mẫu thì khách nhận câu mặc định trung tính thay vì nội dung đúng.
--    DO NOTHING (không đích cụ thể) bỏ qua cả trùng id lẫn trùng code.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-account-deletion-requested', 'ACCOUNT_DELETION_REQUESTED', 'INAPP', '🗑️ Khách {{user}} (SĐT {{phone}}) yêu cầu xoá tài khoản. Vào trang quản trị (Tài khoản → Yêu cầu xoá) để xử lý.'),
  ('nt-dealer-credit-confirmed', 'DEALER_CREDIT_PAYMENT_CONFIRMED', 'INAPP', '✅ Tubu Tree đã xác nhận nhận {{amount}}đ trả nợ của bạn — công nợ đã được cập nhật. Cảm ơn bạn 🌿'),
  ('nt-dealer-credit-reported', 'DEALER_CREDIT_PAYMENT_REPORTED', 'INAPP', '📥 Đại lý {{dealer}} báo đã chuyển khoản {{amount}}đ trả nợ. Vào trang quản trị (Đại lý → Công nợ) để kiểm tra sao kê và xác nhận.'),
  ('nt-flash-starting', 'FLASH_STARTING', 'INAPP', '⚡ Giờ vàng {{product}} đã bắt đầu! Vào săn ưu đãi ngay trước khi hết suất nhé.'),
  ('nt-points-expiring', 'POINTS_EXPIRING', 'INAPP', '⏳ Bạn có {{points}} điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿'),
  ('nt-return-ok-no-refund', 'RETURN_APPROVED_NO_REFUND', 'INAPP', 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt.'),
  ('nt-storefront-trending', 'STOREFRONT_TRENDING_PRODUCTS', 'INAPP', '✨ Có {{count}} sản phẩm nổi bật (như {{sample}}) bạn chưa thêm vào gian hàng — thêm ngay để không bỏ lỡ khách quan tâm!'),
  ('nt-sub-order-failed', 'SUBSCRIPTION_ORDER_FAILED', 'INAPP', 'Đơn định kỳ kỳ này chưa đặt được: {{reason}}. Lịch vẫn giữ, Tubu sẽ thử lại kỳ sau 🌿')
ON CONFLICT DO NOTHING;

-- 2) Sửa lời ORDER_DELIVERED (từng khẳng định "Điểm Xanh đã được cộng" kể cả đơn trả bằng xu, không tích điểm) và
--    WELCOME_VOUCHER (thiếu đơn tối thiểu). Chỉ đổi khi nội dung vẫn đúng bản seed cũ, để không đè bản admin đã sửa.
UPDATE "notification_templates"
SET "bodyTemplate" = 'Đơn {{order_code}} đã giao thành công.{{points_note}} Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿'
WHERE "code" = 'ORDER_DELIVERED'
  AND "bodyTemplate" = 'Đơn {{order_code}} đã giao thành công. Điểm Xanh đã được cộng!';

UPDATE "notification_templates"
SET "bodyTemplate" = 'Chào mừng bạn đến Tubu Tree! Tặng mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}}, dùng trước {{expires}} 🎁'
WHERE "code" = 'WELCOME_VOUCHER'
  AND "bodyTemplate" = 'Chào mừng bạn đến Tubu Tree! Tặng voucher {{code}} giảm {{value}}đ, dùng trước {{expires}} 🎁';

-- 3) Mức mã giảm giá sinh nhật theo hạng (đúng số tên hạng đã hứa ở mô tả quyền lợi: 50k / 150k / 300k). Cột
--    birthdayVoucherAmount mới thêm nên NULL ở mọi hạng; NULL làm VouchersService cấp mức mặc định chung 50k cho cả
--    Đại Thụ và Cổ Thụ. Chỉ điền chỗ còn NULL.
UPDATE "membership_tiers" SET "birthdayVoucherAmount" = 50000 WHERE "id" = 'LOC_BIEC' AND "birthdayVoucherAmount" IS NULL;
UPDATE "membership_tiers" SET "birthdayVoucherAmount" = 150000 WHERE "id" = 'DAI_THU' AND "birthdayVoucherAmount" IS NULL;
UPDATE "membership_tiers" SET "birthdayVoucherAmount" = 300000 WHERE "id" = 'CO_THU' AND "birthdayVoucherAmount" IS NULL;

-- 4) Khoá cấu hình để admin THẤY và sửa được ở tab Cấu hình (tab chỉ liệt kê dòng đã có).
--    voucher.*: giá trị trùng đúng mặc định code đang dùng khi khoá chưa có, nên không đổi hành vi. Khoá cũ
--    loyalty.welcome_voucher_* (seed cũ, không code nào đọc) KHÔNG được sao giá trị sang: chưa từng có hiệu lực.
--    shipping.eta_*: JSON null = chưa đặt, app ẩn dòng "Giao dự kiến" (hành vi hiện tại); admin đặt số để bật.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('voucher.welcome_amount', '30000'::jsonb, 'Mã giảm giá chào mừng khách mới (đ)', 'voucher', now()),
  ('voucher.welcome_min_order', '199000'::jsonb, 'Đơn tối thiểu (đ) để dùng mã giảm giá chào mừng', 'voucher', now()),
  ('voucher.birthday_amount', '50000'::jsonb, 'Mã giảm giá sinh nhật mặc định (đ) cho hạng chưa có mức riêng (mức riêng theo hạng nằm ở bảng hạng thành viên)', 'voucher', now()),
  ('voucher.winback_days', '60'::jsonb, 'Khách từng mua nhưng quá số ngày này chưa đặt lại thì nhận mã giảm giá quay lại', 'voucher', now()),
  ('voucher.winback_amount', '50000'::jsonb, 'Mã giảm giá quay lại (đ)', 'voucher', now()),
  ('voucher.milestones', '[{"spend":1000000,"reward":30000},{"spend":3000000,"reward":100000},{"spend":5000000,"reward":200000}]'::jsonb, 'Mốc chi tiêu trong tháng (đ) → mã giảm giá tri ân (đ); khách nhận mốc cao nhất đạt được', 'voucher', now()),
  ('shipping.eta_min_days', 'null'::jsonb, 'Giao dự kiến: số ngày tối thiểu (0-60). Để null thì app ẩn dòng "Giao dự kiến"', 'shipping', now()),
  ('shipping.eta_max_days', 'null'::jsonb, 'Giao dự kiến: số ngày tối đa (0-60, không nhỏ hơn mức tối thiểu). Để null thì app ẩn dòng "Giao dự kiến"', 'shipping', now())
ON CONFLICT ("key") DO NOTHING;
