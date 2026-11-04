-- Lời mời đang chờ trên PROD (SĐT chưa có tài khoản) từng không có hạn: cho 7 ngày kể từ lúc deploy để người được mời kịp đăng nhập,
-- quá hạn thì applyGrants bỏ qua. Grant của người đã có tài khoản là grant đã áp nên giữ expiresAt rỗng. Bảng role_grants chỉ vài dòng,
-- chạy lại không đổi (chỉ dòng chưa có hạn).
UPDATE "role_grants" g
SET "expiresAt" = now() + interval '7 days'
WHERE g."revokedAt" IS NULL
  AND g."expiresAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."phone" = g."phone");
