-- Đồng bộ Pancake từng ghi tên biến thể bằng Object.values(fields).join(' - '). Pancake trả fields là MẢNG object
-- [{id, name, value, keyValue}], nên tên thành "[object Object]" (hoặc "[object Object] - [object Object]").
-- Dựng lại tên từ cột attributes (mảng, đúng thứ tự Pancake): các "value" nối " - ". Không dựng được (attributes không phải mảng,
-- không phần tử nào có value chữ hoặc số) thì dùng tên sản phẩm, như nhánh tạo biến thể của đồng bộ.
-- Chỉ động vào dòng có tên chứa "[object Object]": tên admin đã sửa tay hoặc tên đúng giữ nguyên, không đụng cột nào khác.
-- Idempotent: sau lần chạy đầu không còn dòng nào khớp WHERE.
UPDATE "variations" v
SET "name" = COALESCE(
  (
    SELECT string_agg(btrim(f."val"), ' - ' ORDER BY f."ord")
    FROM (
      SELECT
        e."ord",
        CASE jsonb_typeof(e."item")
          WHEN 'string' THEN e."item" #>> '{}'
          WHEN 'number' THEN e."item" #>> '{}'
          WHEN 'object' THEN CASE jsonb_typeof(e."item" -> 'value')
            WHEN 'string' THEN e."item" ->> 'value'
            WHEN 'number' THEN e."item" ->> 'value'
          END
        END AS "val"
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v."attributes") = 'array' THEN v."attributes" ELSE '[]'::jsonb END)
        WITH ORDINALITY AS e("item", "ord")
    ) f
    WHERE f."val" IS NOT NULL AND btrim(f."val") <> '' AND f."val" NOT LIKE '%[object Object]%'
  ),
  (SELECT p."name" FROM "products" p WHERE p."id" = v."productId"),
  v."name"
)
WHERE v."name" LIKE '%[object Object]%';
