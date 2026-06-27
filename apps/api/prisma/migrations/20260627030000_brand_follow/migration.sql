-- CreateTable
CREATE TABLE "brand_follows" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "brand_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_follows_brandId_idx" ON "brand_follows"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_follows_userId_brandId_key" ON "brand_follows"("userId", "brandId");

-- AddForeignKey
ALTER TABLE "brand_follows" ADD CONSTRAINT "brand_follows_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
