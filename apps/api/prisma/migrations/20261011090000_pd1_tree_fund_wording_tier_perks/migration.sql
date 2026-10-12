-- C-010 (Q-16): bỏ lời hứa "cây thật / PanNature" và các quyền lợi hạng chưa có quy trình thực hiện.
-- Chỉ UPDATE dữ liệu chữ, không đổi cấu trúc, không xoá dòng nào. PROD không chạy `prisma db seed`, nên các thay
-- đổi ở prisma/seed.ts phải đi kèm file này. Mỗi câu chỉ khớp khi nội dung còn ĐÚNG bản seed cũ (admin đã sửa tay
-- thì giữ nguyên) và chạy lại lần hai không khớp dòng nào nên không đổi gì.

-- 1) Quyền lợi hạng: bỏ "Ưu tiên hotline", "Beta tester", "quà sinh nhật cá nhân hóa", "+ 1 sample", "+ hộp quà"
--    (mã không có cơ chế nào thực hiện) và thống nhất "Mã giảm giá" (Q-26). Các quyền lợi còn lại đều có cơ chế:
--    tích điểm theo pointMultiplier, freeship theo shipping.tier_freeship_overrides, giảm 5% theo discountPct,
--    mã sinh nhật theo birthdayVoucherAmount.
UPDATE "membership_tiers"
SET "perks" = '["Tích điểm 1.2x","Freeship đơn ≥ 99k","Mã giảm giá sinh nhật 50k"]'::jsonb
WHERE "name" = 'Lộc Biếc'
  AND "perks" = '["Tích điểm 1.2x","Freeship đơn ≥ 99k","Voucher sinh nhật 50k"]'::jsonb;

UPDATE "membership_tiers"
SET "perks" = '["Tích điểm 1.5x","Freeship toàn shop","Mã giảm giá sinh nhật 150k"]'::jsonb
WHERE "name" = 'Đại Thụ'
  AND "perks" = '["Tích điểm 1.5x","Freeship toàn shop","Ưu tiên hotline","Beta tester","Voucher sinh nhật 150k + 1 sample"]'::jsonb;

UPDATE "membership_tiers"
SET "perks" = '["Tích điểm 2x","Freeship + giảm 5% mọi đơn","Mã giảm giá sinh nhật 300k"]'::jsonb
WHERE "name" = 'Cổ Thụ'
  AND "perks" = '["Tích điểm 2x","Freeship + giảm 5% mọi đơn","Quà sinh nhật cá nhân hóa","Voucher sinh nhật 300k + hộp quà"]'::jsonb;

-- 2) Câu quiz q6 hỏi "Cây thật được trồng qua đối tác nào?" (đáp án PanNature) = nêu đối tác như cam kết đã có.
--    Đổi sang câu về hồ nước chung của cộng đồng (đúng cơ chế của Mục tiêu cộng đồng); đáp án đúng vẫn ở vị trí 0
--    nên lượt trả lời cũ (quizId + isCorrect) không bị lệch.
UPDATE "game_quizzes"
SET "question" = 'Khi thu hoạch cây ảo, giọt nước bạn đã tưới được góp vào đâu?',
    "options" = '["Hồ nước chung của cộng đồng","Ví Tubu của bạn","Kho hàng của đại lý","Quỹ khuyến mãi"]'::jsonb
WHERE "id" = 'q6'
  AND "correct" = 0
  AND "question" = 'Cây thật được trồng qua đối tác nào?'
  AND "options" = '["PanNature","WWF","GreenID","IUCN"]'::jsonb;

-- 3) Mô tả khoá cấu hình hiển thị cho admin ở tab Cấu hình.
UPDATE "system_configs"
SET "description" = 'Giá góp 1 cây vào quỹ trồng cây bằng xu'
WHERE "key" = 'game.tree_xu_price'
  AND "description" = 'Giá mua 1 cây thật bằng xu';
