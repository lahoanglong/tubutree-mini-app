-- AlterTable
ALTER TABLE "game_profiles" ADD COLUMN     "brokenStreakAt" TIMESTAMP(3),
ADD COLUMN     "brokenStreakDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastStreakRepairAt" TIMESTAMP(3);
