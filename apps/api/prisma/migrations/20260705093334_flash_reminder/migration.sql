-- CreateTable
CREATE TABLE "flash_sale_reminders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "flashSaleItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "flash_sale_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flash_sale_reminders_flashSaleItemId_idx" ON "flash_sale_reminders"("flashSaleItemId");

-- CreateIndex
CREATE UNIQUE INDEX "flash_sale_reminders_userId_flashSaleItemId_key" ON "flash_sale_reminders"("userId", "flashSaleItemId");

-- AddForeignKey
ALTER TABLE "flash_sale_reminders" ADD CONSTRAINT "flash_sale_reminders_flashSaleItemId_fkey" FOREIGN KEY ("flashSaleItemId") REFERENCES "flash_sale_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
