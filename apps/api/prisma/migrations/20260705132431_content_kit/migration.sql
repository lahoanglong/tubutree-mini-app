-- CreateTable
CREATE TABLE "product_content_kits" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "captions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "faqs" JSONB,
    "videoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_content_kits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_content_kits_productId_key" ON "product_content_kits"("productId");

-- AddForeignKey
ALTER TABLE "product_content_kits" ADD CONSTRAINT "product_content_kits_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
