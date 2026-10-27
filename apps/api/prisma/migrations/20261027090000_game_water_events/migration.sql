-- CreateTable
CREATE TABLE "game_water_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_water_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_water_events_userId_createdAt_idx" ON "game_water_events"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "game_water_events_reason_refId_key" ON "game_water_events"("reason", "refId");

-- AddForeignKey
ALTER TABLE "game_water_events" ADD CONSTRAINT "game_water_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

