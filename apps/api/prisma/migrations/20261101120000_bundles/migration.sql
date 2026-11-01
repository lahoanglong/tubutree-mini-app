-- CreateEnum
CREATE TYPE "BundleKind" AS ENUM ('BUNDLE_PCT', 'ADDON');

-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL,
    "kind" "BundleKind" NOT NULL,
    "title" TEXT NOT NULL,
    "pct" INTEGER,
    "anchorProductId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_items" (
    "bundleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variationId" TEXT,
    "addonPrice" INTEGER,
    "maxQty" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bundle_items_pkey" PRIMARY KEY ("bundleId","productId")
);

-- CreateIndex
CREATE INDEX "bundles_isActive_startAt_endAt_idx" ON "bundles"("isActive", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "bundles_anchorProductId_idx" ON "bundles"("anchorProductId");

-- CreateIndex
CREATE INDEX "bundle_items_productId_idx" ON "bundle_items"("productId");

-- CreateIndex
CREATE INDEX "bundle_items_variationId_idx" ON "bundle_items"("variationId");

-- AddForeignKey
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_anchorProductId_fkey" FOREIGN KEY ("anchorProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "variations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Giá không âm và khung giờ hợp lệ giữ ở DB để ghi tay hay đường khác cũng không lách được.
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_pct_chk" CHECK ("pct" IS NULL OR "pct" BETWEEN 1 AND 100);
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_window_chk" CHECK ("endAt" > "startAt");
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_addon_price_chk" CHECK ("addonPrice" IS NULL OR "addonPrice" >= 0);
ALTER TABLE "bundle_items" ADD CONSTRAINT "bundle_items_max_qty_chk" CHECK ("maxQty" BETWEEN 1 AND 10);
