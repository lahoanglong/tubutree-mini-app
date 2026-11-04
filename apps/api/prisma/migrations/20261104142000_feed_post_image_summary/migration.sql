-- Danh sách bảng tin chỉ vẽ ảnh bìa + số ảnh nhưng phải giải nén mảng ảnh base64 (TOAST, tới 6 x 700 nghìn ký tự) của mọi bài
-- trong trang chỉ để lấy phần tử đầu và đếm. Lưu sẵn hai cột tóm tắt để danh sách không đụng cột "images":
--   "imageCount": số phần tử của images (kể cả chuỗi lạ mà danh sách không trả).
--   "coverRef":   ảnh https/http đầu tiên nguyên văn, hoặc md5(<id bài>:0:<ảnh data: đầu tiên>) (cùng mã feedImageVersion ở
--                 feed/feed-images.ts); NULL khi không có ảnh hoặc ảnh đầu là chuỗi lạ.
-- Một trigger giữ hai cột này theo "images" (mã phụ thuộc id bài và có ba nơi ghi images, gồm cả SQL thô dọn ảnh khách vãng lai),
-- nên không nơi ghi nào quên cập nhật được. ADD COLUMN có DEFAULT hằng không viết lại bảng.
ALTER TABLE "feed_posts" ADD COLUMN IF NOT EXISTS "imageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "feed_posts" ADD COLUMN IF NOT EXISTS "coverRef" TEXT;

CREATE OR REPLACE FUNCTION feed_posts_image_summary_sync() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $fn$
DECLARE
  cover text;
BEGIN
  NEW."imageCount" := COALESCE(cardinality(NEW."images"), 0);
  cover := NEW."images"[1];
  NEW."coverRef" := CASE
    WHEN cover ~ '^https?://' THEN cover
    WHEN cover LIKE 'data:%' THEN md5(NEW."id" || ':0:' || cover)
    ELSE NULL
  END;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS feed_posts_image_summary_sync ON "feed_posts";
CREATE TRIGGER feed_posts_image_summary_sync
BEFORE INSERT OR UPDATE OF "images" ON "feed_posts"
FOR EACH ROW EXECUTE FUNCTION feed_posts_image_summary_sync();

-- Backfill idempotent: chỉ bài có ảnh mà chưa có tóm tắt. Không ghi lại cột images (UPDATE chỉ đặt hai cột tóm tắt nên trigger,
-- vốn chỉ chạy khi "images" nằm trong SET, không kích hoạt); mỗi bài giải nén mảng một lần.
UPDATE "feed_posts" p
SET "imageCount" = s."cnt",
    "coverRef" = CASE
      WHEN s."cover" ~ '^https?://' THEN s."cover"
      WHEN s."cover" LIKE 'data:%' THEN md5(p."id" || ':0:' || s."cover")
      ELSE NULL
    END
FROM (
  SELECT f."id", cardinality(f."images") AS "cnt", f."images"[1] AS "cover"
  FROM "feed_posts" f
  WHERE cardinality(f."images") > 0
) s
WHERE p."id" = s."id" AND p."imageCount" = 0;
