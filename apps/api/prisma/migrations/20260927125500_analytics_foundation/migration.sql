-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "endCustomerKey" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "platform" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "subscriptionId" TEXT;

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "anonymousId" TEXT,
    "sessionId" TEXT,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "entrySource" TEXT,
    "notificationId" TEXT,
    "refCode" TEXT,
    "storefrontSlug" TEXT,
    "props" JSONB NOT NULL,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_daily_snapshot" (
    "date" TIMESTAMP(3) NOT NULL,
    "newBuyers" INTEGER NOT NULL,
    "activeBuyers" INTEGER NOT NULL,
    "ordersCount" INTEGER NOT NULL,
    "ordersPerBuyerMtd" DECIMAL(65,30) NOT NULL,
    "dauProxyRefreshToken" INTEGER NOT NULL,
    "dauEventBased" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_daily_snapshot_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "cohort_repeat_snapshot" (
    "id" TEXT NOT NULL,
    "cohortMonth" TIMESTAMP(3) NOT NULL,
    "newBuyersInCohort" INTEGER NOT NULL,
    "repeat30dCount" INTEGER NOT NULL,
    "repeat30dComplete" BOOLEAN NOT NULL,
    "repeat60dCount" INTEGER NOT NULL,
    "repeat60dComplete" BOOLEAN NOT NULL,
    "repeat90dCount" INTEGER NOT NULL,
    "repeat90dComplete" BOOLEAN NOT NULL,
    "medianDaysToSecondOrder" DECIMAL(65,30),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_repeat_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funnel_daily_snapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "step" TEXT NOT NULL,
    "entrySource" TEXT,
    "count" INTEGER NOT NULL,

    CONSTRAINT "funnel_daily_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_eventId_key" ON "analytics_events"("eventId");

-- CreateIndex
CREATE INDEX "analytics_events_eventName_occurredAt_idx" ON "analytics_events"("eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "analytics_events_userId_occurredAt_idx" ON "analytics_events"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "analytics_events_anonymousId_idx" ON "analytics_events"("anonymousId");

-- CreateIndex
CREATE UNIQUE INDEX "cohort_repeat_snapshot_cohortMonth_key" ON "cohort_repeat_snapshot"("cohortMonth");

-- CreateIndex
CREATE UNIQUE INDEX "funnel_daily_snapshot_date_step_entrySource_key" ON "funnel_daily_snapshot"("date", "step", "entrySource");
