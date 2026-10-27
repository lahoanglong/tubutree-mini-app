-- Ngày điểm danh dùng vé giữ lửa: nhiệm vụ điểm danh có mốc không tính ngày lỡ được vé che là ngày điểm danh thật.
ALTER TABLE "game_profiles" ADD COLUMN IF NOT EXISTS "lastStreakFreezeAt" TIMESTAMP(3);
