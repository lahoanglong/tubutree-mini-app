-- Danh sách đánh giá công khai dựng đường dẫn ảnh từ cột nhẹ này, không phải đọc cột images (base64).
-- Phần tử i: md5 10 ký tự hex của ảnh base64 thứ i, hoặc chính URL nếu ảnh không phải data URL.
-- ADD COLUMN có DEFAULT hằng không viết lại bảng (PG 11+). Backfill idempotent: chỉ dòng có ảnh mà chưa có phiên bản.
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "imageVersions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "reviews" r
SET "imageVersions" = ARRAY(
  SELECT CASE WHEN t.img LIKE 'data:%' THEN substr(md5(t.img), 1, 10) ELSE t.img END
  FROM unnest(r."images") WITH ORDINALITY AS t(img, ord)
  ORDER BY t.ord
)
WHERE cardinality(r."images") > 0 AND cardinality(r."imageVersions") = 0;
