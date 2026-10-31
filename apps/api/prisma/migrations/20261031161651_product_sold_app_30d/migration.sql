-- AlterTable
ALTER TABLE "products" ADD COLUMN     "soldApp30d" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "products_soldApp30d_idx" ON "products"("soldApp30d");
