-- PD-3 (Q-03, Q-03a): Điểm Xanh hai lô. Chỉ THÊM kiểu/cột/index, không xoá, không đổi dữ liệu cũ
-- (trừ quy rewardXu → rewardPoints của sự kiện cộng đồng, UPDATE idempotent).
-- ADD COLUMN ... DEFAULT <hằng> trên Postgres >= 11 chỉ sửa catalog, không viết lại bảng.
-- Chạy lại được trên DB đã áp (IF NOT EXISTS / khối DO bắt duplicate_object): Prisma chạy cả file trong một
-- transaction nên lỗi giữa chừng không để lại gì; guard này cho người trực chạy tay lại file sau
-- `prisma migrate resolve --rolled-back 20261012100000_pd3_points_lot_schema`, hoặc kiểm trên bản sao.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "PointsLot" AS ENUM ('STANDARD', 'CONVERTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Mọi dòng cũ và mọi chỗ ghi hiện có tự là STANDARD.
ALTER TABLE "points_transactions" ADD COLUMN IF NOT EXISTS "lot" "PointsLot" NOT NULL DEFAULT 'STANDARD';
-- Lô quy đổi không bao giờ hết hạn: dòng CONVERTED có expiresAt thì cron hết hạn có thể trừ nhầm tiền trả trước.
DO $$
BEGIN
  ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_converted_no_expiry"
    CHECK ("lot" <> 'CONVERTED' OR "expiresAt" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pointsConvertedBalance" INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_points_converted_nonneg" CHECK ("pointsConvertedBalance" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pointsUsedConverted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "community_events" ADD COLUMN IF NOT EXISTS "rewardPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ctv_milestone_claims" ADD COLUMN IF NOT EXISTS "rewardPoints" INTEGER NOT NULL DEFAULT 0;

-- Sự kiện cộng đồng đã tạo bằng xu: quy sang điểm (làm tròn lên; cột INTEGER nên (x + 999) / 1000 là
-- chia nguyên). Chỉ dòng chưa có rewardPoints.
UPDATE "community_events" SET "rewardPoints" = ("rewardXu" + 999) / 1000
 WHERE "rewardPoints" = 0 AND "rewardXu" > 0;

-- Khoá idempotency mới trên points_transactions (thay cho bản coin_transactions_*). Không dòng điểm
-- cũ nào mang các refType này nên tạo index không thể vướng dữ liệu trùng.
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_xu_migration_key"
  ON "points_transactions"("refId") WHERE "refType" = 'XU_MIGRATION' AND "refId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "coin_transactions_xu_migration_key"
  ON "coin_transactions"("refId") WHERE "refType" = 'XU_MIGRATION' AND "refId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_referral_unique"
  ON "points_transactions"("reason") WHERE "refType" = 'REFERRAL';
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_community_reason_key"
  ON "points_transactions"("reason") WHERE "refType" = 'COMMUNITY';
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_quest_unique"
  ON "points_transactions"("userId", "reason") WHERE "refType" = 'QUEST';
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_converted_refund_unique"
  ON "points_transactions"("reason", "refId")
  WHERE "refType" = 'ORDER' AND "refId" IS NOT NULL
    AND ("reason" LIKE 'ORDER_REFUND_CONVERTED:%' OR "reason" LIKE 'ORDER_REFUND_XU:%');
