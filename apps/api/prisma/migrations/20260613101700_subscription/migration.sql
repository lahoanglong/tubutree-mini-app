-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "intervalWeeks" INTEGER NOT NULL,
    "addressId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_status_nextRunAt_idx" ON "subscriptions"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");
