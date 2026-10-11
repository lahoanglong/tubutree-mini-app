-- PD-3: HOÀN TÁC quy đổi xu → Điểm Xanh (migration 20261012110000_pd3_xu_to_points). KHÔNG tự chạy:
-- file nằm ngoài prisma/migrations nên migrate deploy không áp. Người vận hành chạy tay bằng psql:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f prisma/manual/pd3_xu_to_points_rollback.sql
--
-- Chỉ dùng khi ĐỦ hai điều kiện (spec PD-3 mục 3.5, 10):
--   1. Chưa có đơn nào tiêu điểm quy đổi: SELECT count(*) FROM orders WHERE "pointsUsedConverted" > 0  = 0
--      (khối bên dưới tự kiểm và dừng nếu sai). Sau khi khách đã tiêu lô quy đổi thì chỉ sửa tiến.
--   2. Đã dựng lại image API trước PD-3 (code cũ không biết lô; KHÔNG chạy migrate deploy của bản cũ).
--
-- Lô còn nguyên → trả đúng coinsBefore (khách không giữ phần làm tròn). Lô đã tiêu một phần → trả
-- LEAST(coinsBefore, số điểm còn lại × 1000). Chạy lại = không làm gì (mỗi user có tối đa một dòng
-- XU_MIGRATION_ROLLBACK ở mỗi sổ). Không xoá bảng chụp, không xoá dòng sổ nào; cột/enum mới để nguyên.

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_coins_frozen";

DO $$
DECLARE
  spent_orders INTEGER;
BEGIN
  LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE "coin_transactions" IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO spent_orders FROM "orders" WHERE "pointsUsedConverted" > 0;
  IF spent_orders > 0 THEN
    RAISE EXCEPTION 'PD-3 rollback: % đơn đã tiêu điểm quy đổi; không hoàn tác dữ liệu, chỉ sửa tiến', spent_orders;
  END IF;

  CREATE TEMP TABLE _pd3_rb ON COMMIT DROP AS
  SELECT x."userId", x."coinsBefore", x."pointsGranted",
         LEAST(x."pointsGranted", u."pointsConvertedBalance") AS pts_back
    FROM "xu_points_conversions" x JOIN "users" u ON u."id" = x."userId"
   WHERE NOT EXISTS (SELECT 1 FROM "points_transactions" p
                      WHERE p."refType" = 'XU_MIGRATION_ROLLBACK' AND p."refId" = x."userId");

  INSERT INTO "points_transactions" ("id", "userId", "delta", "reason", "refType", "refId", "expiresAt", "lot", "createdAt")
  SELECT 'ptx_xu2pts_rb_' || "userId", "userId", -pts_back, 'XU_TO_POINTS_ROLLBACK', 'XU_MIGRATION_ROLLBACK', "userId",
         NULL, 'CONVERTED', CURRENT_TIMESTAMP
    FROM _pd3_rb WHERE pts_back > 0;

  INSERT INTO "coin_transactions" ("id", "userId", "delta", "reason", "refType", "refId", "createdAt")
  SELECT 'ctx_xu2pts_rb_' || "userId", "userId",
         CASE WHEN pts_back = "pointsGranted" THEN "coinsBefore" ELSE LEAST("coinsBefore", pts_back * 1000) END,
         'XU_TO_POINTS_ROLLBACK', 'XU_MIGRATION_ROLLBACK', "userId", CURRENT_TIMESTAMP
    FROM _pd3_rb WHERE pts_back > 0;

  UPDATE "users" u
     SET "pointsConvertedBalance" = u."pointsConvertedBalance" - r.pts_back,
         "coinsBalance" = u."coinsBalance" +
           CASE WHEN r.pts_back = r."pointsGranted" THEN r."coinsBefore" ELSE LEAST(r."coinsBefore", r.pts_back * 1000) END
    FROM _pd3_rb r
   WHERE u."id" = r."userId" AND r.pts_back > 0;
END $$;
