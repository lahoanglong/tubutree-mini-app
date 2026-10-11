-- PD-3 (Q-03, Q-03a): Điểm Xanh hai lô. Chỉ THÊM kiểu/cột/index, không xoá, không đổi dữ liệu cũ
-- (trừ quy rewardXu → rewardPoints của sự kiện cộng đồng, UPDATE idempotent).
-- ADD COLUMN ... DEFAULT <hằng> trên Postgres >= 11 chỉ sửa catalog, không viết lại bảng.

-- CreateEnum
CREATE TYPE "PointsLot" AS ENUM ('STANDARD', 'CONVERTED');

-- Mọi dòng cũ và mọi chỗ ghi hiện có tự là STANDARD.
ALTER TABLE "points_transactions" ADD COLUMN "lot" "PointsLot" NOT NULL DEFAULT 'STANDARD';
-- Lô quy đổi không bao giờ hết hạn: dòng CONVERTED có expiresAt thì cron hết hạn có thể trừ nhầm tiền trả trước.
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_converted_no_expiry"
  CHECK ("lot" <> 'CONVERTED' OR "expiresAt" IS NULL);

ALTER TABLE "users" ADD COLUMN "pointsConvertedBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD CONSTRAINT "users_points_converted_nonneg" CHECK ("pointsConvertedBalance" >= 0);

ALTER TABLE "orders" ADD COLUMN "pointsUsedConverted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "community_events" ADD COLUMN "rewardPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ctv_milestone_claims" ADD COLUMN "rewardPoints" INTEGER NOT NULL DEFAULT 0;

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
