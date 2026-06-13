-- CreateTable
CREATE TABLE "reorder_reminders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "lastOrderAt" TIMESTAMP(3) NOT NULL,
    "remindedAt" TIMESTAMP(3),

    CONSTRAINT "reorder_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reorder_reminders_userId_idx" ON "reorder_reminders"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "reorder_reminders_userId_variationId_key" ON "reorder_reminders"("userId", "variationId");

