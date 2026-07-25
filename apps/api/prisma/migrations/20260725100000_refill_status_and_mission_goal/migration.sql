-- CreateEnum
CREATE TYPE "RefillStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "bottle_returns" ADD COLUMN "status" "RefillStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "missions" ADD COLUMN "goal" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "bottle_returns_status_idx" ON "bottle_returns"("status");
