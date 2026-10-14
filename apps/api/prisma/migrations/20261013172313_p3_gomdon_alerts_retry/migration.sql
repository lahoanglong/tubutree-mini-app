-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "gomdonAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gomdonCancelRetrySince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "gomdon_alerts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "gomdon_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gomdon_alerts_orderId_resolvedAt_idx" ON "gomdon_alerts"("orderId", "resolvedAt");

-- CreateIndex
CREATE INDEX "gomdon_alerts_resolvedAt_createdAt_idx" ON "gomdon_alerts"("resolvedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "gomdon_alerts" ADD CONSTRAINT "gomdon_alerts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
