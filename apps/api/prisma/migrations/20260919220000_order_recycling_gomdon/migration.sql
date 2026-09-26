-- AlterTable
ALTER TABLE "orders" ADD COLUMN "hasRecyclingPickup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recyclingNote" TEXT,
ADD COLUMN "gomdonOrderId" TEXT,
ADD COLUMN "gomdonPartnerCode" TEXT,
ADD COLUMN "gomdonStatus" TEXT;

-- CreateIndex
CREATE INDEX "orders_gomdonOrderId_idx" ON "orders"("gomdonOrderId");

-- CreateIndex
CREATE INDEX "orders_gomdonPartnerCode_idx" ON "orders"("gomdonPartnerCode");
