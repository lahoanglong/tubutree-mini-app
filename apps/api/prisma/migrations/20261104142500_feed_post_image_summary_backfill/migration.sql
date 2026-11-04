-- Tính hai cột tóm tắt cho các bài có sẵn (trigger của 20261104142000 đã lo mọi ghi mới). Idempotent: chỉ bài có ảnh mà chưa có tóm tắt. Không ghi lại cột images (UPDATE chỉ đặt hai cột tóm tắt nên trigger,
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
