-- Backfill Brand entity từ Product.brand (idempotent)
INSERT INTO "brands" ("id", "slug", "name", "isPublished", "isVerified", "createdAt", "updatedAt")
SELECT
  md5(p."brand"),
  lower(regexp_replace(regexp_replace(p."brand", '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g')),
  p."brand",
  false,
  false,
  now(),
  now()
FROM (SELECT DISTINCT "brand" FROM "products" WHERE "brand" IS NOT NULL AND "brand" <> '') p
ON CONFLICT ("name") DO NOTHING;

-- Set Product.brandId theo tên brand
UPDATE "products" pr
SET "brandId" = b."id"
FROM "brands" b
WHERE pr."brand" = b."name" AND pr."brandId" IS NULL;
