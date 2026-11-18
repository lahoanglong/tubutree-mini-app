-- Quà tặng dùng thử 0đ theo mốc giỏ (tubu-w3-06): lựa chọn quà lưu ở giỏ, dòng quà trên đơn có cờ riêng, ba khoá cấu hình (cờ TẮT).
-- Chỉ thêm cột có mặc định và thêm dòng cấu hình khi chưa có: không đổi dữ liệu đang có.
ALTER TABLE "carts" ADD COLUMN "giftChoice" TEXT;
ALTER TABLE "order_items" ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('commerce.gift_trial_enabled', 'false'::jsonb, 'Quà tặng dùng thử 0đ: tạm tính phần hàng Tubu Tree giao đạt mốc thì giỏ và thanh toán hiện "Chọn quà tặng 0đ", đơn có thêm một dòng quà 0đ đi cùng kiện Tubu (trừ kho quà, không đổi tiền, điểm, hoa hồng). Cần ít nhất một quà còn hàng trong commerce.gift_trial_options. Chỉ bật khi Mini App bản có ô chọn quà đã lên Zalo. Tắt thì giỏ, thanh toán và đơn như cũ.', 'commerce', NOW()),
  ('commerce.gift_trial_min_order', '299000'::jsonb, 'Mốc mở quà tặng dùng thử 0đ (đồng, luật A6 mặc định 299.000đ): đơn có tạm tính phần hàng Tubu Tree giao từ mức này được chọn một quà. Quà nào có mốc riêng thấp hơn mức này cũng bị nâng lên mức này.', 'commerce', NOW()),
  ('commerce.gift_trial_options', '[]'::jsonb, 'Danh sách quà tặng dùng thử, tối đa 6: [{"variationId":"<id biến thể>","minOrder":499000}]. minOrder bỏ trống thì theo commerce.gift_trial_min_order. Biến thể phải đang bán, kho Tubu giao, còn hàng; mục sai dạng hoặc trùng bị bỏ qua.', 'commerce', NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('flashsale.green_hour_enabled', 'false'::jsonb, 'Giờ Xanh Ưu Đãi: khối Giờ vàng ở Trang chủ và Ưu đãi đổi tên thành "Giờ Xanh Ưu Đãi", màu xanh, và mỗi thẻ có nút ＋ thêm một chạm vào giỏ (giá, suất, giới hạn mua giữ nguyên của Giờ vàng). Tắt thì khối như cũ.', 'flashsale', NOW())
ON CONFLICT ("key") DO NOTHING;
