-- Nội dung bổ sung từ MSS (wave tubu-mss-catalog-enrichment, hợp đồng commerce v0.9 mục 1.2–1.5): chỉ thêm bảng, không đổi bảng có sẵn.
-- Ảnh cũ chạy trên DB mới: ảnh cũ không đọc hai bảng này; xoá sản phẩm thì dòng bổ sung đi theo (CASCADE).

CREATE TABLE "product_mss_enrichment" (
    "productId" TEXT NOT NULL,
    "pancakeProductId" TEXT NOT NULL,
    "mssProductId" TEXT,
    "state" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "mssUpdatedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sha256" TEXT NOT NULL,
    "title" TEXT,
    "imagesOverride" BOOLEAN NOT NULL DEFAULT false,
    "coverImage" TEXT,
    "categoryOverride" BOOLEAN NOT NULL DEFAULT false,
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_mss_enrichment_pkey" PRIMARY KEY ("productId")
);

CREATE INDEX "product_mss_enrichment_state_idx" ON "product_mss_enrichment"("state");

CREATE INDEX "product_mss_enrichment_categoryIds_gin" ON "product_mss_enrichment" USING GIN ("categoryIds");

ALTER TABLE "product_mss_enrichment" ADD CONSTRAINT "product_mss_enrichment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mss_catalog_sync_state" (
    "id" TEXT NOT NULL,
    "watermark" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastFullAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastTrigger" TEXT,
    "lastStats" JSONB,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mss_catalog_sync_state_pkey" PRIMARY KEY ("id")
);
