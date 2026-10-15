-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pancakeCancelStatus" TEXT,
ADD COLUMN     "pancakeLastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "pancakePaymentSynced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pancakePushAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pancakePushClaimedAt" TIMESTAMP(3),
ADD COLUMN     "pancakePushStatus" TEXT,
ADD COLUMN     "pancakeSyncError" TEXT;

-- CreateIndex
CREATE INDEX "orders_pancakePushStatus_idx" ON "orders"("pancakePushStatus");

-- CreateIndex
CREATE INDEX "orders_pancakeCancelStatus_idx" ON "orders"("pancakeCancelStatus");

-- Đơn đã lên Pancake trước khi có cột trạng thái đồng bộ. Các cột khác để mặc định: đơn PAID gần đây chưa mang
-- thông tin "không thu COD" sẽ được cron cứu hộ cập nhật sang Pancake (pancakePaymentSynced = false).
UPDATE "orders" SET "pancakePushStatus" = 'SYNCED' WHERE "pancakeOrderId" IS NOT NULL;
