-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- ADMINOPS-7: miniapp/web luôn gửi mã dạng HOA không khoảng trắng và CouponsService tra theo dạng đó,
-- nên mã cũ lưu chữ thường/có khoảng trắng không ai áp được. Chuẩn hoá các mã đó; bỏ qua mã mà dạng
-- chuẩn hoá đã thuộc về một mã khác (tránh vi phạm unique) hoặc trùng nhau trong chính lô này.
WITH candidates AS (
  SELECT id, upper(regexp_replace(code, '\s+', '', 'g')) AS norm
  FROM "coupons"
  WHERE code <> upper(regexp_replace(code, '\s+', '', 'g'))
),
safe AS (
  SELECT c.id, c.norm
  FROM candidates c
  WHERE NOT EXISTS (SELECT 1 FROM "coupons" x WHERE x.code = c.norm)
    AND (SELECT count(*) FROM candidates d WHERE d.norm = c.norm) = 1
)
UPDATE "coupons" AS t
SET code = safe.norm
FROM safe
WHERE t.id = safe.id;
