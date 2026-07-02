-- Xoá ảnh demo picsum (dữ liệu seed cũ — ảnh ngẫu nhiên vô nghĩa, trông giả) khỏi products:
--   thumbnail → NULL; loại các URL picsum khỏi mảng images.
-- FE đã có placeholder lá cho ảnh rỗng → hiển thị sạch, nhất quán (miniapp + web).
-- Pancake sync sẽ ghi đè ảnh THẬT khi có (sync dùng imgs[0] ?? existing → ảnh thật thắng),
-- nên thao tác này an toàn + đảo ngược được. Idempotent — chạy lại vô hại.

UPDATE "products"
SET "thumbnail" = NULL
WHERE "thumbnail" LIKE 'https://picsum.photos/%';

UPDATE "products"
SET "images" = COALESCE(
  (SELECT array_agg(x) FROM unnest("images") AS x WHERE x NOT LIKE 'https://picsum.photos/%'),
  ARRAY[]::text[]
)
WHERE array_to_string("images", ',') LIKE '%picsum.photos%';
