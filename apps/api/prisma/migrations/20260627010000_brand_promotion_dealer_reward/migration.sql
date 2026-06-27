-- CreateEnum
CREATE TYPE "DealerRewardType" AS ENUM ('TOUR', 'GIFT', 'OTHER');

-- CreateTable
CREATE TABLE "brand_promotions" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "themeColor" TEXT,
    "couponCode" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brand_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_rewards" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "type" "DealerRewardType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "threshold" INTEGER NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'QUARTER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dealer_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_promotions_brandId_isActive_idx" ON "brand_promotions"("brandId", "isActive");

-- CreateIndex
CREATE INDEX "dealer_rewards_brandId_isActive_idx" ON "dealer_rewards"("brandId", "isActive");

-- AddForeignKey
ALTER TABLE "brand_promotions" ADD CONSTRAINT "brand_promotions_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_rewards" ADD CONSTRAINT "dealer_rewards_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
