-- PD-3 Q-03a: 1.000 xu = 1 Điểm Xanh (làm tròn LÊN), vào lô CONVERTED không hết hạn.
-- Mỗi user coinsBalance > 0 nhận đúng 1 dòng points (+N, lot CONVERTED) và 1 dòng coin (−coinsBalance),
-- rồi coinsBalance = 0. Không xoá dòng nào của coin_transactions.
-- Lớp chặn chạy lại: PK bảng chụp theo userId, id dòng sổ cố định theo userId, partial unique
-- *_xu_migration_key theo refId = userId, và chỉ cộng số dư cho user vừa chụp ở CHÍNH lần chạy này.
--
-- Dừng (RAISE) nếu loyalty.vnd_per_point_redeem có dòng mà khác đúng 1.000 (1.000:1 chỉ giữ giá trị khi
-- 1 điểm = 1.000đ; RANGES chỉ chặn ghi từ nay, không chặn giá trị đã nằm sẵn trong DB), nếu có user
-- coinsBalance âm hoặc lệch SUM(coin_transactions.delta): quy đổi sai tiền trả trước không sửa ngược êm được. Đo trước bằng truy vấn ở docs/2026-10-review/impl/PD-3-SPEC.md mục 3.3 (b).
-- Sau khi đối soát: prisma migrate resolve --rolled-back 20261012110000_pd3_xu_to_points rồi migrate deploy lại.
-- Hoàn tác (chỉ khi chưa có đơn tiêu điểm quy đổi): prisma/manual/pd3_xu_to_points_rollback.sql.

CREATE TABLE IF NOT EXISTS "xu_points_conversions" (
  "userId"          TEXT NOT NULL,
  "coinsBefore"     INTEGER NOT NULL,
  "pointsBefore"    INTEGER NOT NULL,
  "convertedBefore" INTEGER NOT NULL,
  "pointsGranted"   INTEGER NOT NULL,
  "roundingVnd"     INTEGER NOT NULL,   -- pointsGranted*1000 - coinsBefore, 0..999
  "pointsTxId"      TEXT NOT NULL,
  "coinTxId"        TEXT NOT NULL,
  "convertedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "xu_points_conversions_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "xu_points_conversions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "xu_points_conversions_rounding_chk" CHECK ("roundingVnd" BETWEEN 0 AND 999)
);

DO $$
DECLARE
  neg_users    INTEGER;
  drift_users  INTEGER;
  new_ids      TEXT[];
  leftover     INTEGER;
  rate_cfg     JSONB;
BEGIN
  -- Chặn mọi ghi users/coin_transactions trong lúc chụp và chuyển (container API cũ đã dừng trước
  -- migrate deploy; đây là lớp thứ hai).
  LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE "coin_transactions" IN SHARE ROW EXCLUSIVE MODE;

  -- Không có dòng = mặc định 1.000 của code (pricing.service.ts), hợp lệ. Có dòng mà không phải số 1000
  -- (kể cả chuỗi "1000" hay null) thì dừng để người đối soát quyết, không tự đoán.
  SELECT "value" INTO rate_cfg FROM "system_configs" WHERE "key" = 'loyalty.vnd_per_point_redeem';
  IF FOUND AND (CASE WHEN jsonb_typeof(rate_cfg) = 'number' THEN (rate_cfg #>> '{}')::numeric <> 1000 ELSE true END) THEN
    RAISE EXCEPTION 'PD-3: loyalty.vnd_per_point_redeem = % (phải là số 1000); quy đổi 1.000 xu = 1 điểm chỉ giữ giá trị khi 1 điểm = 1.000đ. Đối soát tay rồi prisma migrate resolve --rolled-back', rate_cfg;
  END IF;

  SELECT count(*) INTO neg_users FROM "users" WHERE "coinsBalance" < 0;
  IF neg_users > 0 THEN
    RAISE EXCEPTION 'PD-3: % user có coinsBalance âm; đối soát tay trước (SELECT id, "coinsBalance" FROM users WHERE "coinsBalance" < 0)', neg_users;
  END IF;

  SELECT count(*) INTO drift_users
    FROM "users" u
   WHERE u."coinsBalance" <> COALESCE((SELECT SUM(c."delta") FROM "coin_transactions" c WHERE c."userId" = u."id"), 0);
  IF drift_users > 0 THEN
    RAISE EXCEPTION 'PD-3: % user có coinsBalance khác SUM(coin_transactions.delta); đối soát trước khi quy đổi', drift_users;
  END IF;

  -- Chỉ những user chụp ở lần chạy này mới được cộng điểm bên dưới. Bản nháp spec cộng cho mọi user có
  -- coinsBalance = coinsBefore: user đã quy đổi ở lần trước, sau đó được cộng xu mới đúng bằng số cũ,
  -- sẽ bị cộng pointsGranted lần hai mà không có dòng sổ nào.
  -- ::bigint: coinsBalance + 999 tràn INTEGER khi số dư > 2.147.482.648 và migration dừng bằng lỗi "integer
  -- out of range" khó hiểu; kết quả (≤ 2.147.484 điểm, làm tròn ≤ 999) vẫn vừa các cột INTEGER.
  WITH ins AS (
    INSERT INTO "xu_points_conversions"
      ("userId", "coinsBefore", "pointsBefore", "convertedBefore", "pointsGranted", "roundingVnd", "pointsTxId", "coinTxId")
    SELECT u."id", u."coinsBalance", u."pointsBalance", u."pointsConvertedBalance",
           (u."coinsBalance"::bigint + 999) / 1000,
           ((u."coinsBalance"::bigint + 999) / 1000) * 1000 - u."coinsBalance",
           'ptx_xu2pts_' || u."id", 'ctx_xu2pts_' || u."id"
      FROM "users" u
     WHERE u."coinsBalance" > 0
       AND NOT EXISTS (SELECT 1 FROM "xu_points_conversions" x WHERE x."userId" = u."id")
    RETURNING "userId"
  )
  SELECT COALESCE(array_agg("userId"), ARRAY[]::TEXT[]) INTO new_ids FROM ins;

  INSERT INTO "points_transactions" ("id", "userId", "delta", "reason", "refType", "refId", "expiresAt", "lot", "createdAt")
  SELECT x."pointsTxId", x."userId", x."pointsGranted", 'XU_TO_POINTS:' || x."coinsBefore", 'XU_MIGRATION', x."userId",
         NULL, 'CONVERTED', x."convertedAt"
    FROM "xu_points_conversions" x
   WHERE x."userId" = ANY(new_ids)
     AND NOT EXISTS (SELECT 1 FROM "points_transactions" p WHERE p."id" = x."pointsTxId");

  INSERT INTO "coin_transactions" ("id", "userId", "delta", "reason", "refType", "refId", "createdAt")
  SELECT x."coinTxId", x."userId", -x."coinsBefore", 'XU_TO_POINTS:' || x."pointsGranted", 'XU_MIGRATION', x."userId",
         x."convertedAt"
    FROM "xu_points_conversions" x
   WHERE x."userId" = ANY(new_ids)
     AND NOT EXISTS (SELECT 1 FROM "coin_transactions" c WHERE c."id" = x."coinTxId");

  UPDATE "users" u
     SET "coinsBalance" = 0,
         "pointsConvertedBalance" = u."pointsConvertedBalance" + x."pointsGranted"
    FROM "xu_points_conversions" x
   WHERE x."userId" = u."id" AND x."userId" = ANY(new_ids)
     AND u."coinsBalance" = x."coinsBefore" AND u."coinsBalance" > 0;

  -- User đã quy đổi ở lần chạy trước mà lại có xu (code cũ còn ghi xu giữa hai lần chạy): không tự quy
  -- đổi lần hai (PK bảng chụp). Báo để đối soát tay; migration đóng băng xu (users_coins_frozen) sẽ dừng
  -- deploy cho tới khi số dư này được xử lý.
  SELECT count(*) INTO leftover FROM "users" WHERE "coinsBalance" <> 0;
  IF leftover > 0 THEN
    RAISE WARNING 'PD-3: % user vẫn còn coinsBalance <> 0 sau quy đổi (đã quy đổi ở lần chạy trước); đối soát tay', leftover;
  END IF;
END $$;
