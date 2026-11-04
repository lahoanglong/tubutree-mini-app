-- Lời mời đang chờ trên PROD (SĐT chưa có tài khoản) từng không có hạn.
-- 1) Lời mời ADMIN cho số chưa có tài khoản bị thu hồi luôn: không còn cấp quyền quản trị cho số lạ (ai đăng nhập bằng số đó sau này
--    cũng thành ADMIN), nên không gia hạn lời mời kiểu đó. Admin muốn cấp lại thì chờ người đó đăng nhập một lần rồi cấp.
-- 2) Lời mời vai trò khác: cho 7 ngày kể từ lúc deploy để người được mời kịp đăng nhập, quá hạn thì bị bỏ qua.
-- Grant của người đã có tài khoản là grant đã áp nên giữ expiresAt rỗng. Bảng role_grants chỉ vài dòng; chạy lại không đổi gì thêm.
UPDATE "role_grants" g
SET "revokedAt" = now(),
    "note" = CASE WHEN g."note" IS NULL OR g."note" = '' THEN 'Thu hồi tự động: lời mời ADMIN cho số chưa có tài khoản'
                  ELSE g."note" || ' | Thu hồi tự động: lời mời ADMIN cho số chưa có tài khoản' END
WHERE g."revokedAt" IS NULL
  AND g."expiresAt" IS NULL
  AND g."role" = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."phone" = g."phone");

UPDATE "role_grants" g
SET "expiresAt" = now() + interval '7 days'
WHERE g."revokedAt" IS NULL
  AND g."expiresAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."phone" = g."phone");
