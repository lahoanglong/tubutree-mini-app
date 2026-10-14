-- p8-seller: khoá cấu hình và mẫu thông báo mà code gói này đọc/gửi. Không đổi schema; mọi câu idempotent, không ghi đè
-- giá trị/nội dung admin đã chỉnh.

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('merchant.default_shipping_fee', '30000'::jsonb, 'Phí giao một kiện của gian hàng đối tác tự giao khi gian hàng chưa đặt phí riêng (đồng)', 'merchant', now()),
  ('merchant.commission_pct', '0.15'::jsonb, 'Phí sàn Tubu thu trên tiền hàng đơn đối tác tự giao khi gian hàng chưa có mức riêng (phân số, 0.15 = 15%)', 'merchant', now()),
  ('merchant.settlement_hold_days', '7'::jsonb, 'Số ngày sau khi giao đơn đối tác mới đưa vào bảng kê đối soát (nên bằng hạn đổi/trả)', 'merchant', now()),
  ('merchant.confirm_sla_hours', '24'::jsonb, 'Đối tác phải xác nhận đơn tự giao trong chừng này giờ, quá hạn thì nhắc và hiện ở trang quản trị', 'merchant', now()),
  ('merchant.ship_sla_hours', '48'::jsonb, 'Đối tác phải gửi hàng (nhập mã vận đơn) trong chừng này giờ kể từ khi khách đặt', 'merchant', now()),
  ('merchant.deliver_sla_days', '7'::jsonb, 'Đơn đối tác đang giao quá chừng này ngày chưa xác nhận đã giao thì hiện ở danh sách quá hạn', 'merchant', now()),
  ('storefront.identifier_cooldown_days', '90'::jsonb, 'Subdomain/tên miền gian hàng vừa đổi hoặc gỡ chỉ gian hàng khác dùng lại sau chừng này ngày', 'storefront', now()),
  ('orders.dealer_pending_payment_ttl_hours', '72'::jsonb, 'Đơn đại lý trả trước chờ chuyển khoản quá số giờ này thì tự huỷ (hoàn kho). Tối thiểu 1, tối đa 720', 'orders', now()),
  ('affiliate.pit_withhold_pct', '0.1'::jsonb, 'Thuế TNCN khấu trừ khi trả hoa hồng CTV (phân số, 0.1 = 10%; 0 = tắt)', 'affiliate', now()),
  ('affiliate.pit_withhold_threshold', '2000000'::jsonb, 'Lần rút hoa hồng từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)', 'affiliate', now())
ON CONFLICT ("key") DO NOTHING;

UPDATE "system_configs" SET "description" = 'Đơn trả trước (khách lẻ/CTV) chờ thanh toán quá số giờ này thì tự huỷ (hoàn kho, coupon). Tối thiểu 1, tối đa 720; đơn đại lý dùng orders.dealer_pending_payment_ttl_hours'
WHERE "key" = 'orders.pending_payment_ttl_hours' AND "description" LIKE '%không áp đơn đại lý';

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ctv-payout-approved', 'COMMISSION_PAYOUT_APPROVED', 'INAPP', 'Lệnh rút {{amount}} của bạn đã được duyệt, Tubu Tree sẽ chuyển khoản trong thời gian sớm nhất.'),
  ('nt-ctv-payout-rejected', 'COMMISSION_PAYOUT_REJECTED', 'INAPP', 'Lệnh rút {{amount}} chưa được duyệt: {{reason}}. Hoa hồng đã trả lại số dư khả dụng, bạn kiểm tra rồi gửi lệnh mới nhé.'),
  ('nt-ctv-commission-reversed', 'COMMISSION_REVERSED', 'INAPP', 'Khoản hoa hồng dự kiến {{amount}} đã bị thu hồi vì đơn của khách bị huỷ hoặc trả hàng.'),
  ('nt-merchant-order-new', 'MERCHANT_ORDER_NEW', 'INAPP', '🛒 Gian hàng của bạn có đơn mới {{order_code}} ({{total}}đ). Vào Cổng người bán → Đơn cần giao để xác nhận và gửi hàng.'),
  ('nt-merchant-order-cancelled', 'MERCHANT_ORDER_CANCELLED', 'INAPP', 'Đơn {{order_code}} đã bị huỷ ({{reason}}). Bạn không cần gửi hàng cho đơn này nữa.'),
  ('nt-merchant-order-overdue', 'MERCHANT_ORDER_OVERDUE', 'INAPP', '⏰ Đơn {{order_code}} đã quá hạn {{step}}. Vào Cổng người bán → Đơn cần giao để xử lý ngay, tránh khách phải chờ.'),
  ('nt-merchant-cancelled-by-seller', 'MERCHANT_ORDER_CANCELLED_BY_SELLER', 'INAPP', 'Rất tiếc, {{store}} đã huỷ đơn {{order_code}}: {{reason}}. Tiền bạn đã trả trước (nếu có) được hoàn theo chính sách của Tubu Tree.'),
  ('nt-merchant-payout-created', 'MERCHANT_PAYOUT_CREATED', 'INAPP', 'Tubu Tree đã lập phiếu đối soát {{amount}}đ cho {{count}} đơn của gian hàng. Xem chi tiết ở Cổng người bán → Đối soát.'),
  ('nt-merchant-payout-paid', 'MERCHANT_PAYOUT_PAID', 'INAPP', 'Phiếu đối soát {{amount}}đ của gian hàng đã được tất toán (mã giao dịch {{bank_ref}}).'),
  ('nt-merchant-product-approved', 'MERCHANT_PRODUCT_APPROVED', 'INAPP', '✅ Sản phẩm "{{product_name}}" đã được duyệt và đang bán trên Tubu Tree.'),
  ('nt-merchant-product-rejected', 'MERCHANT_PRODUCT_REJECTED', 'INAPP', 'Sản phẩm "{{product_name}}" chưa được duyệt: {{reason}}. Sửa lại trong Cổng người bán để gửi duyệt lại.'),
  ('nt-ops-merchant-product', 'OPS_MERCHANT_PRODUCT_PENDING', 'INAPP', '📦 Gian hàng {{store}} gửi sản phẩm "{{product_name}}" ({{mode}}) chờ duyệt. Vào trang quản trị → Duyệt sản phẩm đối tác.'),
  ('nt-ops-dealer-application', 'OPS_DEALER_APPLICATION_PENDING', 'INAPP', '📝 Hồ sơ đại lý mới: {{business}} ({{owner}}, {{phone}}). Vào trang quản trị → Đại lý để duyệt.'),
  ('nt-dealer-app-approved', 'DEALER_APPLICATION_APPROVED', 'INAPP', '🎉 Hồ sơ đại lý của bạn đã được duyệt, bậc {{tier}}. Vào mục Đại lý để xem bảng giá sỉ và đặt hàng.'),
  ('nt-dealer-app-rejected', 'DEALER_APPLICATION_REJECTED', 'INAPP', 'Hồ sơ đại lý của bạn chưa được duyệt: {{reason}}. Bạn có thể bổ sung thông tin và nộp lại.')
ON CONFLICT DO NOTHING;
