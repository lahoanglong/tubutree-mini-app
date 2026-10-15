-- Dọn ghi chú hệ thống đã lỡ nối vào orders.note (ghi chú khách viết, hiện trên trang đơn của khách).
-- Bản gốc vẫn còn trong order_status_history.note. Chỉ bỏ các đoạn hệ thống tự sinh ("Gomdon webhook: ...",
-- "Tự huỷ: quá ..."), giữ nguyên phần khách viết; không còn gì thì để NULL. Chạy lại không đổi gì thêm.
WITH affected AS (
  SELECT o."id",
         (
           SELECT string_agg(seg.part, ' | ' ORDER BY seg.idx)
           FROM regexp_split_to_table(o."note", ' \| ') WITH ORDINALITY AS seg(part, idx)
           WHERE seg.part NOT LIKE 'Gomdon webhook: %'
             AND seg.part NOT LIKE 'Tự huỷ: quá %'
         ) AS cleaned
  FROM "orders" o
  WHERE o."note" LIKE '%Gomdon webhook: %'
     OR o."note" LIKE '%Tự huỷ: quá %'
)
UPDATE "orders" o
SET "note" = NULLIF(a.cleaned, '')
FROM affected a
WHERE o."id" = a."id"
  AND o."note" IS DISTINCT FROM NULLIF(a.cleaned, '');
