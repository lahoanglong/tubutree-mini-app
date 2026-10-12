-- C-010 (Q-16, Q-26) sau review: thống nhất "Điểm Xanh" ở quyền lợi hạng, và mốc cộng đồng không còn hứa trồng cây
-- tại một địa điểm cụ thể (chưa có quy trình trồng thật). Chỉ UPDATE dữ liệu chữ, không đổi cấu trúc, không xoá dòng.
-- PROD không chạy `prisma db seed` nên các thay đổi ở prisma/seed.ts phải đi kèm file này. Mỗi câu chỉ khớp khi nội
-- dung còn ĐÚNG kết quả migration _pd1_tree_fund_wording_tier_perks (admin đã sửa tay thì giữ nguyên); chạy lại lần
-- hai không khớp dòng nào nên không đổi gì.

-- 1) Quyền lợi hạng: "Tích điểm Nx" thành "Tích Điểm Xanh xN" (hệ số vẫn là MembershipTier.pointMultiplier).
UPDATE "membership_tiers"
SET "perks" = '["Tích Điểm Xanh x1"]'::jsonb
WHERE "name" = 'Mầm Xanh'
  AND "perks" = '["Tích điểm 1x"]'::jsonb;

UPDATE "membership_tiers"
SET "perks" = '["Tích Điểm Xanh x1.2","Freeship đơn ≥ 99k","Mã giảm giá sinh nhật 50k"]'::jsonb
WHERE "name" = 'Lộc Biếc'
  AND "perks" = '["Tích điểm 1.2x","Freeship đơn ≥ 99k","Mã giảm giá sinh nhật 50k"]'::jsonb;

UPDATE "membership_tiers"
SET "perks" = '["Tích Điểm Xanh x1.5","Freeship toàn shop","Mã giảm giá sinh nhật 150k"]'::jsonb
WHERE "name" = 'Đại Thụ'
  AND "perks" = '["Tích điểm 1.5x","Freeship toàn shop","Mã giảm giá sinh nhật 150k"]'::jsonb;

UPDATE "membership_tiers"
SET "perks" = '["Tích Điểm Xanh x2","Freeship + giảm 5% mọi đơn","Mã giảm giá sinh nhật 300k"]'::jsonb
WHERE "name" = 'Cổ Thụ'
  AND "perks" = '["Tích điểm 2x","Freeship + giảm 5% mọi đơn","Mã giảm giá sinh nhật 300k"]'::jsonb;

-- 2) Mốc cộng đồng seed: bỏ "phủ xanh Cần Giờ" và tên vùng trồng. Mốc do admin đổi tên/vùng thì không khớp WHERE nên giữ nguyên.
UPDATE "community_goals"
SET "title" = 'Cùng Tubu góp quỹ trồng cây',
    "region" = 'Cộng đồng Tubu'
WHERE "id" = 'cg-cangio-2026'
  AND "title" = 'Cùng Tubu phủ xanh Cần Giờ'
  AND "region" = 'Rừng ngập mặn Cần Giờ, TP.HCM';
