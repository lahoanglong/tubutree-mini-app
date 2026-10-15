-- CreateTable
CREATE TABLE "product_edit_drafts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDesc" TEXT,
    "images" TEXT[],
    "thumbnail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_edit_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_edit_drafts_productId_key" ON "product_edit_drafts"("productId");

-- CreateIndex
CREATE INDEX "product_edit_drafts_createdAt_idx" ON "product_edit_drafts"("createdAt");

-- AddForeignKey
ALTER TABLE "product_edit_drafts" ADD CONSTRAINT "product_edit_drafts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
