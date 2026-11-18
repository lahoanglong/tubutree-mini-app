-- Đặt hàng trên web không cần đăng nhập Zalo (tubu-w4-01). Chỉ cộng: ba cột rỗng trên orders (không chỉ mục, không giá trị mặc định nên
-- không viết lại bảng) và bốn dòng cấu hình. Cờ mặc định TẮT; chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
ALTER TABLE "orders" ADD COLUMN "guestPhone" TEXT;
ALTER TABLE "orders" ADD COLUMN "guestTokenHash" TEXT;
ALTER TABLE "orders" ADD COLUMN "guestIpHash" TEXT;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('web.guest_checkout_enabled', 'false'::jsonb, 'Khách chưa đăng nhập trên web đặt hàng bằng số điện thoại (không cần Zalo), theo dõi đơn bằng đường dẫn riêng. Không dùng mã giảm giá, Điểm Xanh, giá Giờ vàng; không tích điểm. Tắt thì trang thanh toán bắt đăng nhập như cũ.', 'web', NOW()),
  ('checkout.guest_cod_max', '500000'::jsonb, 'Đơn khách vãng lai (web, không đăng nhập) có tổng tiền trên mức này chỉ nhận chuyển khoản, không nhận COD (đồng).', 'checkout', NOW()),
  ('checkout.guest_daily_ip_cap', '5'::jsonb, 'Số đơn khách vãng lai tối đa mỗi IP trong 24 giờ.', 'checkout', NOW()),
  ('checkout.guest_blocked_phones', '[]'::jsonb, 'Danh sách SĐT (dạng 0xxxxxxxxx) không được đặt hàng khi chưa đăng nhập. Khách nhận lời mời đăng nhập Zalo, không biết mình bị chặn.', 'checkout', NOW())
ON CONFLICT ("key") DO NOTHING;
