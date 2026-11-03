-- XANH-03: quyền lợi hạng viết "Freeship ..." trái bảng thuật ngữ (DESIGN.md: dùng "Miễn phí giao hàng"). Chỉ UPDATE dữ liệu chữ,
-- không đổi cam kết (ngưỡng miễn phí giao vẫn do shipping.tier_freeship_overrides). PROD không chạy `prisma db seed` nên thay đổi
-- ở prisma/seed.ts phải đi kèm file này. Chỉ thay đúng phần tử còn là chuỗi cũ (admin đã sửa tay thì giữ nguyên, thứ tự quyền lợi
-- giữ nguyên); chạy lại lần hai không khớp dòng nào nên không đổi gì.
UPDATE "membership_tiers" mt
SET "perks" = (
  SELECT jsonb_agg(
    CASE
      WHEN e.val = to_jsonb('Freeship đơn ≥ 99k'::text) THEN to_jsonb('Miễn phí giao hàng đơn từ 99k'::text)
      WHEN e.val = to_jsonb('Freeship toàn shop'::text) THEN to_jsonb('Miễn phí giao hàng mọi đơn'::text)
      WHEN e.val = to_jsonb('Freeship + giảm 5% mọi đơn'::text) THEN to_jsonb('Miễn phí giao hàng và giảm 5% mọi đơn'::text)
      ELSE e.val
    END
    ORDER BY e.ord
  )
  FROM jsonb_array_elements(mt."perks") WITH ORDINALITY AS e(val, ord)
)
WHERE jsonb_typeof(mt."perks") = 'array'
  AND (
    mt."perks" @> to_jsonb(ARRAY['Freeship đơn ≥ 99k'])
    OR mt."perks" @> to_jsonb(ARRAY['Freeship toàn shop'])
    OR mt."perks" @> to_jsonb(ARRAY['Freeship + giảm 5% mọi đơn'])
  );
