-- GET /me/coupons (C-012 / A3-001): lọc coupon theo user ngay trong SQL thay vì nạp mọi coupon
-- còn hạn rồi lọc bằng JS. Hai partial index phục vụ đúng hai nhánh truy vấn:
--   * coupon cá nhân (USER_GROUP) tra theo scopeMeta->>'userId'
--   * coupon chung (PUBLIC/TIER) quét theo hạn — tập nhỏ vì phần lớn coupon là cá nhân
-- Additive, không đổi dữ liệu. Index nằm ngoài schema.prisma (Prisma không biểu diễn được
-- partial/expression index); `IF NOT EXISTS` để chạy lại an toàn.
--
-- PROD: CREATE INDEX thường chặn ghi bảng coupons tới khi build xong (bảng nhỏ, tính bằng giây).
-- Nếu cần tránh khoá, chạy CONCURRENTLY thủ công rồi `prisma migrate resolve --applied
-- 20261010040000_coupon_scope_partial_indexes`.

CREATE INDEX IF NOT EXISTS "coupons_user_group_userId_idx"
  ON "coupons" (("scopeMeta" ->> 'userId'))
  WHERE "scope" = 'USER_GROUP';

CREATE INDEX IF NOT EXISTS "coupons_scope_shared_endAt_idx"
  ON "coupons" ("endAt")
  WHERE "scope" IN ('PUBLIC', 'TIER');
