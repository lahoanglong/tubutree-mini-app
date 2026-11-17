-- Một dòng thời gian ở chi tiết đơn, bật báo Zalo từ chi tiết đơn, trang đích link mời. Chỉ CỘNG.
-- Nguồn đồng ý Zalo của từng đơn: 'order_detail' khi khách bật ngay ở chi tiết đơn; null = đồng ý lúc đặt hàng, hoặc đơn có từ trước khi có cột này.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "orderZaloConsentSource" TEXT;

-- Cờ và cấu hình mặc định TẮT. Chỉ thêm dòng khi chưa có, không đổi giá trị admin đã đặt.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('orders.timeline_v2_enabled', 'false'::jsonb, 'Chi tiết đơn (Mini App và web) gộp thanh tiến trình và hành trình thành một dòng thời gian: 4 bước kèm giờ, mốc hãng vận chuyển gập dưới "Đang giao hàng", dòng "Đã báo qua Zalo" khi tin đã tới khách. Tắt thì giữ hai khối cũ.', 'orders', NOW()),
  ('orders.tracking_stale_hours', '72'::jsonb, 'Đơn đang giao quá số giờ này mà hãng vận chuyển không có mốc mới thì chi tiết đơn ghi "Đang chờ hãng vận chuyển cập nhật" (chỉ khi bật dòng thời gian mới). 1 đến 720 giờ.', 'orders', NOW()),
  ('referral.share_card_enabled', 'false'::jsonb, 'Link "Mời bạn sống xanh" trỏ trang đích tubutree.com/moi/<mã> có ảnh xem trước riêng, và khối mời hiện tiến độ (số bạn đã nhận mã, đã mua đơn đầu, đã đủ điều kiện). Không đổi thưởng. Tắt thì giữ link cũ và trang đích trả 404.', 'referral', NOW())
ON CONFLICT ("key") DO NOTHING;
