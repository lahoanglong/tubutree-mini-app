-- C-055 / Q-10: ngưỡng thưởng và doanh số kỳ của đại lý/CTV có thể vượt 2.147.483.647 (giới hạn INT4).
-- Nới INT4 -> INT8 không mất dữ liệu; Postgres viết lại bảng dưới khoá ACCESS EXCLUSIVE nhưng 3 bảng
-- này chỉ vài chục/trăm dòng (thưởng mốc, yêu cầu nhận thưởng), khoá tính bằng mili giây.

-- AlterTable
ALTER TABLE "ctv_milestone_claims" ALTER COLUMN "revenue" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "dealer_reward_claims" ALTER COLUMN "threshold" SET DATA TYPE BIGINT,
ALTER COLUMN "volumeAtClaim" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "dealer_rewards" ALTER COLUMN "threshold" SET DATA TYPE BIGINT;
