-- PD-3: HOÀN TÁC quy đổi xu → Điểm Xanh (migration 20261012110000_pd3_xu_to_points). KHÔNG tự chạy:
-- file nằm ngoài prisma/migrations nên migrate deploy không áp. Người vận hành chạy tay bằng psql:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f prisma/manual/pd3_xu_to_points_rollback.sql
--
-- Chỉ dùng khi ĐỦ hai điều kiện (spec PD-3 mục 3.5, 10):
--   1. Lô quy đổi chỉ bị TRỪ bớt, chưa bị cộng thêm (khối bên dưới tự kiểm a và b, dừng nếu sai):
--        a. không đơn nào tiêu điểm quy đổi: SELECT count(*) FROM orders WHERE "pointsUsedConverted" > 0 = 0;
--        b. không dòng CỘNG nào vào lô CONVERTED ngoài dòng quy đổi gốc (refType XU_MIGRATION, refId = userId).
--           Dòng cộng khác = gộp phiên khách (dòng quy đổi của khách sang user khác, refId ≠ userId), hoàn
--           đơn xu cũ (ORDER_REFUND_XU), hoàn đơn đã tiêu điểm quy đổi, thưởng mới ghi vào lô quy đổi. Hoàn
--           tác theo bảng chụp không biết trả xu cho chủ mới của dòng đó và để điểm thừa kẹt trong
--           pointsConvertedBalance (code cũ không đọc cột này) nên khách mất giá trị trả trước.
--           Liệt kê: SELECT "userId", "refType", "refId", "reason", "delta" FROM points_transactions
--                     WHERE "lot" = 'CONVERTED' AND "delta" > 0 AND NOT ("refType" = 'XU_MIGRATION' AND "refId" = "userId");
--        c. dòng TRỪ lô quy đổi không qua đơn (góp quỹ trồng cây, thu hồi thưởng giới thiệu) thì được phép:
--           trả LEAST(coinsBefore, số điểm còn lại × 1000).
--   2. Đã dựng lại image API trước PD-3 (code cũ không biết lô; KHÔNG chạy migrate deploy của bản cũ).
--
-- Lô còn nguyên → trả đúng coinsBefore (khách không giữ phần làm tròn). Chạy lại = không làm gì (mỗi user có
-- tối đa một dòng XU_MIGRATION_ROLLBACK ở mỗi sổ). Không xoá bảng chụp, không xoá dòng sổ nào; cột/enum mới
-- để nguyên. Chỉ xoá thông báo XU_CONVERTED (id nlog_xu2pts_<userId>) do migration 20261012160000 chèn.
--
-- MỘT CHIỀU: sau khi chạy, chỉ được sửa tiến; KHÔNG chạy lại migration B. Migration B vẫn nằm trong
-- _prisma_migrations, bảng chụp xu_points_conversions (PK userId) chặn quy đổi lần hai, và ràng buộc
-- users_coins_frozen vừa bị gỡ không tự trở lại. Nếu về sau triển khai lại PD-3 trên cùng DB, code mới không
-- đọc coinsBalance nên số xu đã trả lại sẽ mồ côi. Muốn triển khai lại cần migration quy đổi MỚI (không dùng
-- lại B): chọn user có dòng XU_MIGRATION_ROLLBACK và coinsBalance > 0, id dòng sổ và refType riêng
-- (không đụng khoá *_xu_migration_key), rồi thêm lại users_coins_frozen. Làm qua review riêng.

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_coins_frozen";

DO $$
DECLARE
  spent_orders INTEGER;
  extra_credits INTEGER;
BEGIN
  LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE "coin_transactions" IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE "points_transactions" IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO spent_orders FROM "orders" WHERE "pointsUsedConverted" > 0;
  IF spent_orders > 0 THEN
    RAISE EXCEPTION 'PD-3 rollback: % đơn đã tiêu điểm quy đổi; không hoàn tác dữ liệu, chỉ sửa tiến', spent_orders;
  END IF;

  SELECT count(*) INTO extra_credits FROM "points_transactions" p
   WHERE p."lot" = 'CONVERTED' AND p."delta" > 0
     AND NOT (p."refType" = 'XU_MIGRATION' AND p."refId" = p."userId");
  IF extra_credits > 0 THEN
    RAISE EXCEPTION 'PD-3 rollback: % dòng cộng vào lô quy đổi không phải dòng quy đổi gốc (gộp phiên khách, hoàn đơn xu cũ, ...); hoàn tác sẽ bỏ sót xu hoặc kẹt điểm của khách, chỉ sửa tiến', extra_credits;
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

  -- bigint cho pts_back × 1000: nhánh ELSE chỉ chạy khi pts_back < pointsGranted nên hiện vừa INTEGER,
  -- ép kiểu để không phụ thuộc vào thứ tự CASE.
  INSERT INTO "coin_transactions" ("id", "userId", "delta", "reason", "refType", "refId", "createdAt")
  SELECT 'ctx_xu2pts_rb_' || "userId", "userId",
         CASE WHEN pts_back = "pointsGranted" THEN "coinsBefore" ELSE LEAST("coinsBefore"::bigint, pts_back::bigint * 1000)::integer END,
         'XU_TO_POINTS_ROLLBACK', 'XU_MIGRATION_ROLLBACK', "userId", CURRENT_TIMESTAMP
    FROM _pd3_rb WHERE pts_back > 0;

  UPDATE "users" u
     SET "pointsConvertedBalance" = u."pointsConvertedBalance" - r.pts_back,
         "coinsBalance" = u."coinsBalance" +
           CASE WHEN r.pts_back = r."pointsGranted" THEN r."coinsBefore"
                ELSE LEAST(r."coinsBefore"::bigint, r.pts_back::bigint * 1000)::integer END
    FROM _pd3_rb r
   WHERE u."id" = r."userId" AND r.pts_back > 0;

  -- Thông báo "N xu cũ đã thành M Điểm Xanh" (migration 20261012160000) sẽ sai sau hoàn tác, mà code cũ vẫn
  -- liệt kê mọi notification_logs INAPP của khách. Chỉ xoá đúng dòng migration đó chèn (id cố định theo user +
  -- templateCode); đi theo bảng chụp chứ không theo _pd3_rb để chạy lại vẫn dọn được dòng sót.
  DELETE FROM "notification_logs" l
   USING "xu_points_conversions" x
   WHERE l."id" = 'nlog_xu2pts_' || x."userId" AND l."templateCode" = 'XU_CONVERTED' AND l."channel" = 'INAPP';
END $$;
