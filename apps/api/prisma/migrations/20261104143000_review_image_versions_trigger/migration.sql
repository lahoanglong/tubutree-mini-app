-- "imageVersions" luôn là hàm của "images" (md5 10 ký tự cho ảnh data:, URL nguyên văn cho ảnh khác, cùng công thức backfill ở
-- 20261104140000). Trigger giữ cột này nên mọi nơi ghi images, kể cả bản API cũ chạy lúc đang deploy, đều ra cột đúng.
CREATE OR REPLACE FUNCTION reviews_image_versions_sync() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $fn$
BEGIN
  NEW."imageVersions" := ARRAY(
    SELECT CASE WHEN t.img LIKE 'data:%' THEN substr(md5(t.img), 1, 10) ELSE t.img END
    FROM unnest(NEW."images") WITH ORDINALITY AS t(img, ord)
    ORDER BY t.ord
  );
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS reviews_image_versions_sync ON "reviews";
CREATE TRIGGER reviews_image_versions_sync
BEFORE INSERT OR UPDATE OF "images" ON "reviews"
FOR EACH ROW EXECUTE FUNCTION reviews_image_versions_sync();

-- Bù các đánh giá tạo giữa lúc migration 20261104140000 chạy và trigger này có hiệu lực (idempotent; không kích hoạt trigger vì không đặt "images").
UPDATE "reviews" r
SET "imageVersions" = ARRAY(
  SELECT CASE WHEN t.img LIKE 'data:%' THEN substr(md5(t.img), 1, 10) ELSE t.img END
  FROM unnest(r."images") WITH ORDINALITY AS t(img, ord)
  ORDER BY t.ord
)
WHERE cardinality(r."images") > 0 AND cardinality(r."imageVersions") = 0;
