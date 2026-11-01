-- CreateEnum
CREATE TYPE "CampaignPlacement" AS ENUM ('HOME_TOP', 'OFFERS_TOP');

-- CreateEnum
CREATE TYPE "CampaignLinkType" AS ENUM ('CAMPAIGN_PAGE', 'PRODUCT', 'CATEGORY', 'URL_INTERNAL');

-- CreateEnum
CREATE TYPE "CampaignAudience" AS ENUM ('ALL', 'NEW', 'RETURNING');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "placement" "CampaignPlacement" NOT NULL,
    "image" TEXT NOT NULL,
    "linkType" "CampaignLinkType" NOT NULL DEFAULT 'CAMPAIGN_PAGE',
    "linkValue" TEXT,
    "audience" "CampaignAudience" NOT NULL DEFAULT 'ALL',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_products" (
    "campaignId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "campaign_products_pkey" PRIMARY KEY ("campaignId","productId")
);

-- CreateTable
CREATE TABLE "campaign_coupons" (
    "campaignId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "campaign_coupons_pkey" PRIMARY KEY ("campaignId","couponId")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns"("slug");

-- CreateIndex
CREATE INDEX "campaigns_placement_isActive_startAt_endAt_idx" ON "campaigns"("placement", "isActive", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "campaign_products_productId_idx" ON "campaign_products"("productId");

-- CreateIndex
CREATE INDEX "campaign_coupons_couponId_idx" ON "campaign_coupons"("couponId");

-- AddForeignKey
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_coupons" ADD CONSTRAINT "campaign_coupons_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_coupons" ADD CONSTRAINT "campaign_coupons_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
