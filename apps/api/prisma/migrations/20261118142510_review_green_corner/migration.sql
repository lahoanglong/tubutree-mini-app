-- Góc Sống Xanh: đánh giá có ảnh/video chờ admin duyệt, thưởng Điểm Xanh lúc duyệt, thẻ cảm nhận xanh. Chỉ thêm cột (mặc định giữ hành vi cũ:
-- awaitingApproval false, chưa ai được duyệt), hai chỉ mục, một ràng buộc sổ điểm và ba dòng cấu hình (cờ TẮT). Chạy lại không lỗi.
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "ecoTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "awaitingApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "photoQueuedAt" TIMESTAMP(3);
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "photoRewardPoints" INTEGER NOT NULL DEFAULT 0;

-- Hàng chờ duyệt của admin (WHERE awaitingApproval ORDER BY createdAt) và dải Góc Sống Xanh (đã duyệt, mới duyệt trước).
CREATE INDEX IF NOT EXISTS "reviews_awaitingApproval_createdAt_idx" ON "reviews" ("awaitingApproval", "createdAt");
CREATE INDEX IF NOT EXISTS "reviews_approvedAt_idx" ON "reviews" ("approvedAt" DESC);

-- Thưởng Góc Sống Xanh: tối đa một dòng cho mỗi dòng hàng được đánh giá, reason = REVIEW_PHOTO:<id dòng đơn>. Lớp hai sau khoá advisory
-- của cặp (khách, sản phẩm): xoá đánh giá rồi viết lại, hay admin bấm duyệt hai lần, không cộng lần hai.
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_review_photo_key"
ON "points_transactions" ("reason")
WHERE "refType" = 'REVIEW' AND "reason" LIKE 'REVIEW_PHOTO:%';

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('reviews.green_corner_enabled', 'false'::jsonb, 'Góc Sống Xanh: đánh giá có ảnh hoặc video chờ admin duyệt (tab Đánh giá) rồi mới hiện công khai; duyệt xong cộng reviews.photo_reward_points Điểm Xanh, mỗi dòng đơn một lần, mỗi khách tối đa reviews.photo_reward_daily_cap đánh giá được thưởng cho các đánh giá viết cùng một ngày. Khi bật, bảng thưởng cũ lúc gửi (chỉ chữ 5.000, ảnh 10.000, video 15.000) NGỪNG: đánh giá chỉ chữ hiện ngay nhưng không cộng điểm. Khách chọn thêm tối đa 3 thẻ cảm nhận, tối đa 3 ảnh; Trang chủ hiện dải "Khách hàng sống xanh cùng TubuTree" khi có từ 3 đánh giá ảnh đã duyệt. Tắt thì mọi thứ như cũ; đánh giá đang chờ vẫn duyệt và thưởng được. CHỈ BẬT khi Mini App bản có Góc Sống Xanh đã lên Zalo: bản cũ cho chọn 5 ảnh (máy chủ trả lỗi quá 3 ảnh), báo đánh giá chờ duyệt là "đã ẩn" và vẫn hứa thưởng 10.000 lúc gửi.', 'reviews', NOW()),
  ('reviews.photo_reward_points', '100'::jsonb, 'Điểm Xanh (1 điểm = 1đ) cộng khi admin duyệt một đánh giá có ảnh/video thật ở Góc Sống Xanh. 0 = duyệt không cộng điểm.', 'reviews', NOW()),
  ('reviews.photo_reward_daily_cap', '3'::jsonb, 'Số đánh giá Góc Sống Xanh tối đa được thưởng của một khách cho các đánh giá viết trong cùng một ngày (giờ VN). Vượt trần thì vẫn duyệt và hiện, không cộng điểm.', 'reviews', NOW())
ON CONFLICT ("key") DO NOTHING;
