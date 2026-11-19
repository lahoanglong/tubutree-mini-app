-- Thưởng đơn đầu của chương trình giới thiệu (modules/referral). Chỉ CỘNG.
-- Mã băm IP lúc đặt đơn (HMAC, cùng mục đích với guestIpHash): chặn cặp người mời và bạn được mời đặt cùng IP trong 24 giờ.
-- Cột trống, không mặc định: Postgres chỉ sửa danh mục, không viết lại bảng.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "placedIpHash" TEXT;

-- Cờ TẮT và mức mặc định khớp mã (first-order-reward.ts). Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('growth.referral_viral_enabled', 'false'::jsonb, 'Mời bạn sống xanh: bạn được mời có đơn đầu giao thành công từ growth.referral_first_order_min thì cả người mời và bạn được mời nhận growth.referral_first_order_points Điểm Xanh (chặn trùng SĐT, Zalo, địa chỉ giao, IP trong 24 giờ; trần mỗi tháng theo growth.referral_monthly_cap). Sổ Tay Xanh và Tài khoản hiện thẻ thành tích kèm link mời. Tắt thì không thưởng đơn đầu và không có thẻ; thưởng đơn thứ hai như cũ.', 'growth', NOW()),
  ('growth.referral_first_order_points', '100'::jsonb, 'Điểm Xanh mỗi bên (người mời và bạn được mời) nhận khi đơn đầu của bạn được mời giao thành công. 0 đến 10.000; 0 = không thưởng.', 'growth', NOW()),
  ('growth.referral_first_order_min', '199000'::jsonb, 'Tổng tiền tối thiểu (đồng) của đơn đầu để được thưởng giới thiệu đơn đầu.', 'growth', NOW()),
  ('growth.referral_monthly_cap', '10'::jsonb, 'Số lần thưởng đơn đầu tối đa mỗi người mời trong một tháng (giờ Việt Nam). Đạt trần thì cặp sau trong tháng không ai nhận. 0 đến 1.000.', 'growth', NOW())
ON CONFLICT ("key") DO NOTHING;
