-- Thumbnail của sản phẩm đối tác từng lưu nguyên data URL trùng ảnh đầu (cùng ảnh nằm hai lần trong DB, mỗi thẻ sản phẩm giải mã
-- và băm lại). Đổi sang đường dẫn tới ảnh đầu, đúng chuỗi mà storedThumbnailFor dựng ở common/public-image.ts:
-- /public-image/product/<id>/0?v=<16 ký tự đầu của md5('product:<id>:0:<ảnh đầu>')>.
-- Chỉ động vào dòng thumbnail là ảnh raster base64 và trùng đúng images[1]; thumbnail khác ảnh đầu, link https, SVG giữ nguyên.
-- Idempotent: sau khi đổi, thumbnail không còn bắt đầu bằng "data:" nên lần chạy lại không khớp dòng nào.
UPDATE "products" p
SET "thumbnail" = '/public-image/product/' || p."id" || '/0?v=' || substr(md5('product:' || p."id" || ':0:' || p."images"[1]), 1, 16)
WHERE p."thumbnail" LIKE ANY (ARRAY['data:image/png;base64,%', 'data:image/jpeg;base64,%', 'data:image/jpg;base64,%', 'data:image/webp;base64,%', 'data:image/gif;base64,%'])
  AND p."thumbnail" = p."images"[1];
