-- Hạ chữ slug gian hàng đã tồn tại.
--
-- Gian hàng CTV tạo từ miniapp lưu `slug = user.referralCode`, mà referralCode luôn IN HOA
-- (auth.service.ts sinh bằng toUpperCase). Trong khi đó getPublicBySlug hạ chữ mã tra cứu rồi
-- so khớp CHÍNH XÁC, và Postgres so sánh chuỗi phân biệt hoa/thường (đã kiểm trên DB thật:
-- SELECT 'ABC' = 'abc' → f). Hệ quả: mọi link /s/<slug> của CTV đều trả "không tồn tại".
--
-- Code đã vá 2 phía (ghi chữ thường + đọc insensitive) nên migration này KHÔNG bắt buộc để
-- hệ thống chạy đúng; nó dọn dữ liệu cho nhất quán và để các truy vấn exact-match sau này
-- (báo cáo, join tay) không lệch.
--
-- An toàn với trùng lặp: chỉ hạ chữ khi KHÔNG có gian hàng nào khác đã chiếm bản chữ thường
-- (trường hợp một user vừa có bản HOA từ miniapp vừa có bản thường từ portal web).
UPDATE "storefronts" s
SET "slug" = lower(s."slug")
WHERE s."slug" <> lower(s."slug")
  AND NOT EXISTS (
    SELECT 1 FROM "storefronts" o
    WHERE o."id" <> s."id" AND o."slug" = lower(s."slug")
  );

-- Cùng lý do cho subdomain (được nhập tay ở portal web, đã chuẩn hoá ở code từ trước nhưng
-- dữ liệu cũ có thể còn hoa).
UPDATE "storefronts" s
SET "subdomain" = lower(s."subdomain")
WHERE s."subdomain" IS NOT NULL
  AND s."subdomain" <> lower(s."subdomain")
  AND NOT EXISTS (
    SELECT 1 FROM "storefronts" o
    WHERE o."id" <> s."id" AND o."subdomain" = lower(s."subdomain")
  );
