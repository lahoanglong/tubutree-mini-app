-- CreateEnum
CREATE TYPE "StorefrontType" AS ENUM ('CTV', 'BRAND');

-- CreateEnum
CREATE TYPE "CollectionKind" AS ENUM ('NORMAL', 'COMBO');

-- CreateEnum
CREATE TYPE "CollectionLayout" AS ENUM ('GRID', 'CAROUSEL', 'STACK');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "affiliateBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "brandId" TEXT;

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "tagline" TEXT,
    "story" TEXT,
    "storyImages" TEXT[],
    "origin" TEXT,
    "certifications" JSONB,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT,
    "followerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefronts" (
    "id" TEXT NOT NULL,
    "type" "StorefrontType" NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "brandId" TEXT,
    "title" TEXT NOT NULL,
    "headerNote" TEXT,
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'leaf-orange',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefronts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_collections" (
    "id" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "CollectionKind" NOT NULL DEFAULT 'NORMAL',
    "layout" "CollectionLayout" NOT NULL DEFAULT 'CAROUSEL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "comboDiscountPct" INTEGER,

    CONSTRAINT "storefront_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_items" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variationId" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "storefront_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_slug_key" ON "storefronts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "storefronts_brandId_key" ON "storefronts"("brandId");

-- CreateIndex
CREATE INDEX "storefronts_ownerUserId_idx" ON "storefronts"("ownerUserId");

-- CreateIndex
CREATE INDEX "storefront_collections_storefrontId_idx" ON "storefront_collections"("storefrontId");

-- CreateIndex
CREATE INDEX "storefront_items_collectionId_idx" ON "storefront_items"("collectionId");

-- CreateIndex
CREATE INDEX "products_brandId_idx" ON "products"("brandId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_collections" ADD CONSTRAINT "storefront_collections_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "storefronts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storefront_items" ADD CONSTRAINT "storefront_items_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "storefront_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
