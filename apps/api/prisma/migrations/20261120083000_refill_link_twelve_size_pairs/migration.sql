-- tubu-w9-03 (PO quyết A5): ghép tay 12 cặp chai ↔ gói Refill 10L đang ở trạng thái "Gói lớn hơn 3 lần chai: chờ ghép tay" của thẻ admin
-- "Cặp Refill" (tubu-w6-01). Cùng thương hiệu Fuwa3e, cùng tên công thức, đúng một gói Refill mỗi chai: đúng bảng `size` mà
-- `refill-pairs.spec.ts` khoá trên ảnh chụp danh mục PROD 18/11/2026 (`refill-link-migration.spec.ts` đối chiếu). Không đổi schema.
--
-- Chỉ CỘNG phần tử vào cuối mảng catalog.refill_pairs_override, từng cặp chỉ khi đủ mọi điều kiện:
--   * khoá đã có và đang là mảng (không tạo khoá, không sửa giá trị sai dạng);
--   * chai chưa có mặt trong cặp ghép tay nào, ở vế nào cũng vậy (admin đã ghép chai này với gói khác thì giữ nguyên ý admin);
--   * gói Refill không đang làm chai trong cặp khác (không tạo vòng hay chuỗi cặp);
--   * không slug nào nằm trong catalog.refill_pairs_block (admin đã tắt thì không bật lại);
--   * cả hai sản phẩm đang bán (isActive, approvalStatus APPROVED: cùng điều kiện PUBLIC_PRODUCT_WHERE mà thẻ admin kiểm khi lưu) và
--     không phải combo; slug chai không bắt đầu bằng "refill-", slug gói bắt đầu bằng "refill-"; cùng thương hiệu.
-- Thiếu điều kiện nào thì bỏ đúng cặp đó. DB không có các slug PROD (dev, e2e) thì không đổi gì.
--
-- Có thay đổi thì ghi MỘT dòng system_config_history (id cố định nên chạy lại không ghi thêm; lần sau cũng không còn cặp nào để cộng).
-- Cờ catalog.refill_first_enabled giữ nguyên. Gỡ: admin bấm "Bỏ ghép tay" ở thẻ Cặp Refill, hay ghi lại oldValue của dòng lịch sử.

WITH wanted ("ord", "bottleSlug", "refillSlug") AS (
  VALUES
    (1,  'gel-rua-chen-cho-may-fuwa3e-100ml-e1aa04',    'refill-gel-rua-chen-cho-may-fuwa3e-10l-13467d'),
    (2,  'gel-rua-chen-cho-may-fuwa3e-500ml-f9915e',    'refill-gel-rua-chen-cho-may-fuwa3e-10l-13467d'),
    (3,  'gel-rua-chen-cho-may-fuwa3e-2000ml-ea1def',   'refill-gel-rua-chen-cho-may-fuwa3e-10l-13467d'),
    (4,  'lau-da-nang-fuwa3e-2l-9aa0ed',                'refill-lau-da-nang-fuwa3e-10l-a08433'),
    (5,  'nuoc-lau-san-sa-chanh-fuwa3e-100ml-d10bec',   'refill-nuoc-lau-san-sa-chanh-fuwa3e-10l-b63811'),
    (6,  'nuoc-lau-san-sa-chanh-fuwa3e-1l-51b16f',      'refill-nuoc-lau-san-sa-chanh-fuwa3e-10l-b63811'),
    (7,  'nuoc-ngam-rua-thuc-pham-fuwa3e-100ml-8b4cd8', 'refill-nuoc-ngam-rua-thuc-pham-fuwa3e-10l-fbbea5'),
    (8,  'nuoc-ngam-rua-thuc-pham-fuwa3e-1l-809601',    'refill-nuoc-ngam-rua-thuc-pham-fuwa3e-10l-fbbea5'),
    (9,  'nuoc-rua-chen-fuwa3e-100ml-c1337b',           'refill-nuoc-rua-chen-fuwa3e-10l-69f244'),
    (10, 'nuoc-rua-chen-fuwa3e-500ml-185d77',           'refill-nuoc-rua-chen-fuwa3e-10l-69f244'),
    (11, 'nuoc-rua-tay-dang-bot-fuwa3e-300ml-fdf345',   'refill-nuoc-rua-tay-dang-bot-fuwa3e-10l-ab8688'),
    (12, 'nuoc-rua-tay-dang-gel-fuwa3e-300ml-37dfc0',   'refill-nuoc-rua-tay-dang-gel-fuwa3e-10l-f3ac3e')
),
cfg AS (
  SELECT c."value" AS old_value
  FROM "system_configs" c
  WHERE c."key" = 'catalog.refill_pairs_override' AND jsonb_typeof(c."value") = 'array'
),
existing AS (
  SELECT e ->> 'bottleSlug' AS bottle_slug, e ->> 'refillSlug' AS refill_slug
  FROM cfg, jsonb_array_elements(cfg.old_value) e
  WHERE jsonb_typeof(e) = 'object'
),
blocked AS (
  SELECT jsonb_array_elements_text(b."value") AS slug
  FROM "system_configs" b
  WHERE b."key" = 'catalog.refill_pairs_block' AND jsonb_typeof(b."value") = 'array'
),
additions AS (
  SELECT w."ord", w."bottleSlug", w."refillSlug"
  FROM wanted w
  JOIN "products" bottle ON bottle."slug" = w."bottleSlug" AND bottle."isCombo" = false AND bottle."slug" NOT LIKE 'refill-%'
    AND bottle."isActive" = true AND bottle."approvalStatus"::text = 'APPROVED'
  JOIN "products" refill ON refill."slug" = w."refillSlug" AND refill."isCombo" = false AND refill."slug" LIKE 'refill-%'
    AND refill."isActive" = true AND refill."approvalStatus"::text = 'APPROVED'
    AND lower(btrim(refill."brand")) = lower(btrim(bottle."brand"))
  WHERE EXISTS (SELECT 1 FROM cfg)
    AND NOT EXISTS (SELECT 1 FROM existing x WHERE x.bottle_slug = w."bottleSlug" OR x.refill_slug = w."bottleSlug")
    AND NOT EXISTS (SELECT 1 FROM existing x WHERE x.bottle_slug = w."refillSlug")
    AND NOT EXISTS (SELECT 1 FROM blocked k WHERE k.slug = w."bottleSlug" OR k.slug = w."refillSlug")
),
next_value AS (
  SELECT
    cfg.old_value,
    cfg.old_value || (
      SELECT jsonb_agg(jsonb_build_object('bottleSlug', a."bottleSlug", 'refillSlug', a."refillSlug") ORDER BY a."ord")
      FROM additions a
    ) AS new_value
  FROM cfg
  WHERE EXISTS (SELECT 1 FROM additions)
),
changed AS (
  UPDATE "system_configs" c
  SET "value" = n.new_value, "updatedAt" = now(), "updatedBy" = 'migration:tubu-w9-03'
  FROM next_value n
  WHERE c."key" = 'catalog.refill_pairs_override'
  RETURNING c."key"
)
INSERT INTO "system_config_history" ("id", "key", "oldValue", "newValue", "changedBy")
SELECT 'sch_w903_refill_link_12', 'catalog.refill_pairs_override', n.old_value, n.new_value, 'migration:tubu-w9-03'
FROM next_value n
JOIN changed ch ON ch."key" = 'catalog.refill_pairs_override'
ON CONFLICT ("id") DO NOTHING;
