-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "flashSaleItemId" TEXT;

-- CreateTable
CREATE TABLE "flash_sales" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sale_items" (
    "id" TEXT NOT NULL,
    "flashSaleId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "flashPrice" INTEGER NOT NULL,
    "quota" INTEGER NOT NULL,
    "soldCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL,

    CONSTRAINT "flash_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sale_purchases" (
    "id" TEXT NOT NULL,
    "flashSaleItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flash_sale_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flash_sales_isActive_startAt_endAt_idx" ON "flash_sales"("isActive", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "flash_sale_items_variationId_idx" ON "flash_sale_items"("variationId");

-- CreateIndex
CREATE UNIQUE INDEX "flash_sale_items_flashSaleId_variationId_key" ON "flash_sale_items"("flashSaleId", "variationId");

-- CreateIndex
CREATE UNIQUE INDEX "flash_sale_purchases_flashSaleItemId_userId_key" ON "flash_sale_purchases"("flashSaleItemId", "userId");

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_flashSaleId_fkey" FOREIGN KEY ("flashSaleId") REFERENCES "flash_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_purchases" ADD CONSTRAINT "flash_sale_purchases_flashSaleItemId_fkey" FOREIGN KEY ("flashSaleItemId") REFERENCES "flash_sale_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
