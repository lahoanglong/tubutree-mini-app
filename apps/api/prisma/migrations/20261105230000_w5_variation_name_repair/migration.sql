-- Đồng bộ Pancake từng ghi tên biến thể bằng Object.values(fields).join(' - '). Pancake trả fields là MẢNG object
-- [{id, name, value, keyValue}], nên tên thành "[object Object]" (hoặc "[object Object] - [object Object]").
-- Dựng lại tên từ cột attributes (mảng, đúng thứ tự Pancake): các "value" nối " - ". Không dựng được (attributes không phải mảng,
-- không phần tử nào có value chữ hoặc số) thì dùng tên sản phẩm, như nhánh tạo biến thể của đồng bộ.
-- Chỉ động vào dòng có tên chứa "[object Object]": tên admin đã sửa tay hoặc tên đúng giữ nguyên, không đụng cột nào khác.
-- Idempotent: sau lần chạy đầu không còn dòng nào khớp WHERE.
UPDATE "variations" v
SET "name" = COALESCE(
  (
    SELECT string_agg(f."val", ' - ' ORDER BY f."ord")
    FROM (
      SELECT
        r."ord",
        -- Cắt mọi khoảng trắng hai đầu như String.prototype.trim (tab, xuống dòng, U+00A0, U+FEFF), không chỉ dấu cách như btrim().
        regexp_replace(
          CASE jsonb_typeof(r."raw")
            WHEN 'string' THEN r."raw" #>> '{}'
            WHEN 'number' THEN r."raw" #>> '{}'
          END,
          '^[[:space:]\u00a0\ufeff]+|[[:space:]\u00a0\ufeff]+$', '', 'g'
        ) AS "val"
      FROM (
        -- Phần tử object: "value", không có thì "v" (dạng {k, v}), như variantLabel ở pancake-variant-fields.ts.
        SELECT
          e."ord",
          CASE WHEN jsonb_typeof(e."item") = 'object'
            THEN COALESCE(NULLIF(e."item" -> 'value', 'null'::jsonb), e."item" -> 'v')
            ELSE e."item"
          END AS "raw"
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v."attributes") = 'array' THEN v."attributes" ELSE '[]'::jsonb END)
          WITH ORDINALITY AS e("item", "ord")
      ) r
    ) f
    WHERE f."val" IS NOT NULL AND f."val" <> '' AND f."val" NOT LIKE '%[object Object]%'
  ),
  (SELECT p."name" FROM "products" p WHERE p."id" = v."productId"),
  v."name"
)
WHERE v."name" LIKE '%[object Object]%';
