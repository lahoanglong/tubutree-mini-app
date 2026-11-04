-- Danh sách đánh giá công khai dựng đường dẫn ảnh từ cột nhẹ "imageVersions", không phải đọc cột images (base64).
-- Phần tử i: md5 10 ký tự hex của ảnh base64 thứ i, hoặc chính URL nếu ảnh không phải data URL.
-- Cột là hàm của "images", nên một trigger giữ nó: mọi nơi ghi images, kể cả bản API cũ chạy lúc đang deploy, đều ra cột đúng. Cột và trigger
-- nằm cùng một migration để migration sau không bao giờ chạy mà thiếu trigger (nếu hai bước ở hai migration và bước sau hỏng, bản API cũ ghi
-- ảnh mới mà không cập nhật cột, đường dẫn ảnh giữ mã cũ với cache 1 năm).
-- Migration này chỉ đổi cấu trúc (khoá ACCESS EXCLUSIVE rất ngắn: ADD COLUMN có DEFAULT hằng không viết lại bảng, PG 11+); việc tính lại
-- các dòng cũ nằm ở migration 20261104140500 để khoá bảng không bị giữ suốt lúc băm.
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "imageVersions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

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
