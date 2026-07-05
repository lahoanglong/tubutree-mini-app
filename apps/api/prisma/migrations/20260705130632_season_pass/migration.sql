-- CreateTable
CREATE TABLE "user_season_passes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "claimedFree" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "claimedPremium" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_season_passes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_season_passes_userId_seasonId_key" ON "user_season_passes"("userId", "seasonId");
