-- Backfill Brand entity từ Product.brand (idempotent)
-- slug: collision-safe + non-empty. Giữ slug đẹp khi không trùng; thêm hậu tố hash
-- khi trùng base slug; tên chỉ toàn dấu (base rỗng) → 'brand-' + hash.
INSERT INTO "brands" ("id","slug","name","isPublished","isVerified","createdAt","updatedAt")
SELECT
  md5(d."brand"),
  CASE
    WHEN d.base = '' THEN 'brand-' || substr(md5(d."brand"), 1, 8)
    WHEN d.rn = 1   THEN d.base
    ELSE d.base || '-' || substr(md5(d."brand"), 1, 6)
  END,
  d."brand", false, false, now(), now()
FROM (
  SELECT "brand", base, row_number() OVER (PARTITION BY base ORDER BY "brand") AS rn
  FROM (
    SELECT DISTINCT "brand",
      lower(regexp_replace(regexp_replace("brand", '[^a-zA-Z0-9[:space:]-]', '', 'g'), '[[:space:]]+', '-', 'g')) AS base
    FROM "products" WHERE "brand" IS NOT NULL AND "brand" <> ''
  ) s
) d
ON CONFLICT ("name") DO NOTHING;

-- Set Product.brandId theo tên brand
UPDATE "products" pr
SET "brandId" = b."id"
FROM "brands" b
WHERE pr."brand" = b."name" AND pr."brandId" IS NULL;
