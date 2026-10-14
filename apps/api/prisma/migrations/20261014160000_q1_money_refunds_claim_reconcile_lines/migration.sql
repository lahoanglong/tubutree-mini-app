-- AlterEnum
ALTER TYPE "CustomerRefundStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "lineAmounts" JSONB;

-- AlterTable
ALTER TABLE "order_customer_refunds" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedBy" TEXT;

-- AlterTable
ALTER TABLE "payment_attempts" ADD COLUMN     "lastQueriedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "payment_attempts_provider_resolvedAt_createdAt_idx" ON "payment_attempts"("provider", "resolvedAt", "createdAt");
