-- CreateTable
CREATE TABLE "support_bridge_actions" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_bridge_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_bridge_actions_createdAt_idx" ON "support_bridge_actions"("createdAt");

-- AlterTable: dòng cũ nhận giờ chạy migration; Prisma tự ghi updatedAt nên bỏ DEFAULT để schema khớp.
ALTER TABLE "support_forwards" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "support_forwards" ALTER COLUMN "updatedAt" DROP DEFAULT;
