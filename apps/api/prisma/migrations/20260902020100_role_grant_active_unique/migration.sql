-- Chặn 2 request addGrant() đồng thời cho CÙNG SĐT+role tạo 2 RoleGrant active trùng: findFirst
-- rồi create trong 1 $transaction READ COMMITTED (mặc định) vẫn không atomic — 2 tx song song
-- cùng đọc "chưa có grant" trước khi tx đầu commit. addGrant() bắt P2002 → coi như đã cấp (idempotent).
-- Partial (chỉ revokedAt IS NULL): grant đã revoke không tính, user vẫn có thể được cấp lại role
-- đó sau khi grant cũ bị thu hồi — không khoá lịch sử nhiều lần cấp/thu hồi, chỉ chặn nhiều grant
-- ACTIVE cùng lúc cho cùng phone+role.
CREATE UNIQUE INDEX IF NOT EXISTS "role_grants_active_phone_role_key"
  ON "role_grants"("phone", "role") WHERE "revokedAt" IS NULL;
