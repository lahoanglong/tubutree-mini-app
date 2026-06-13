-- CreateEnum
CREATE TYPE "PlantedStatus" AS ENUM ('PLEDGED', 'PLANTED');

-- CreateTable
CREATE TABLE "planted_trees" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "certificateCode" TEXT NOT NULL,
    "treeType" TEXT NOT NULL DEFAULT 'Cây Dứa Fuwa3e',
    "region" TEXT,
    "status" "PlantedStatus" NOT NULL DEFAULT 'PLEDGED',
    "pledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plantedAt" TIMESTAMP(3),

    CONSTRAINT "planted_trees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planted_trees_certificateCode_key" ON "planted_trees"("certificateCode");

-- CreateIndex
CREATE INDEX "planted_trees_userId_idx" ON "planted_trees"("userId");

-- AddForeignKey
ALTER TABLE "planted_trees" ADD CONSTRAINT "planted_trees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

