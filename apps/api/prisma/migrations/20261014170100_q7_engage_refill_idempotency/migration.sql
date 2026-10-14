-- POST /refill/return honour Idempotency-Key: cột nullable nên dòng cũ giữ nguyên (NULL không trùng nhau trong unique).
-- AlterTable
ALTER TABLE "bottle_returns" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bottle_returns_userId_idempotencyKey_key" ON "bottle_returns"("userId", "idempotencyKey");
