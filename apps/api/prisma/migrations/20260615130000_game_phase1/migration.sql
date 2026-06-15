-- game_phase1: quiz theo chủ đề + thưởng 💧, streak-freeze, dew
ALTER TABLE "game_quizzes" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'nature';
ALTER TABLE "game_quizzes" ADD COLUMN "difficulty" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "game_quizzes" ADD COLUMN "explanation" TEXT;
ALTER TABLE "game_quizzes" ADD COLUMN "waterReward" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "game_profiles" ADD COLUMN "streakFreezes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "game_profiles" ADD COLUMN "lastDewAt" TIMESTAMP(3);
