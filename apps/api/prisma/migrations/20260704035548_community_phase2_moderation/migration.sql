-- CreateTable
CREATE TABLE "community_reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_profiles" (
    "userId" TEXT NOT NULL,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "isExpert" BOOLEAN NOT NULL DEFAULT false,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "bestAnswerCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "community_reports_status_createdAt_idx" ON "community_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "community_reports_targetType_targetId_idx" ON "community_reports"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_profiles" ADD CONSTRAINT "community_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
