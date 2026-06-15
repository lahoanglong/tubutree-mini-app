-- Vườn Xanh 2.0 Phase 2: mốc cộng đồng cây thật
CREATE TYPE "CommunityGoalStatus" AS ENUM ('ACTIVE', 'FULFILLING', 'DONE');

CREATE TABLE "community_goals" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "targetDrops" INTEGER NOT NULL,
    "currentDrops" INTEGER NOT NULL DEFAULT 0,
    "treesToPlant" INTEGER NOT NULL,
    "status" "CommunityGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    CONSTRAINT "community_goals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "community_goals_status_idx" ON "community_goals"("status");

CREATE TABLE "community_contributions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "drops" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "community_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "community_contributions_userId_goalId_key" ON "community_contributions"("userId", "goalId");
CREATE INDEX "community_contributions_goalId_idx" ON "community_contributions"("goalId");

ALTER TABLE "community_contributions" ADD CONSTRAINT "community_contributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_contributions" ADD CONSTRAINT "community_contributions_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "community_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
