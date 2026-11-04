-- Tính "imageVersions" cho các đánh giá có sẵn (trigger của 20261104140000 đã lo mọi ghi mới). Tách khỏi migration thêm cột để khoá
-- ACCESS EXCLUSIVE của ADD COLUMN được nhả trước khi băm hàng loạt ảnh base64.
-- Idempotent: chỉ dòng có ảnh mà chưa có phiên bản. UPDATE không đặt "images" nên trigger không chạy lại.
UPDATE "reviews" r
SET "imageVersions" = ARRAY(
  SELECT CASE WHEN t.img LIKE 'data:%' THEN substr(md5(t.img), 1, 10) ELSE t.img END
  FROM unnest(r."images") WITH ORDINALITY AS t(img, ord)
  ORDER BY t.ord
)
WHERE cardinality(r."images") > 0 AND cardinality(r."imageVersions") = 0;
