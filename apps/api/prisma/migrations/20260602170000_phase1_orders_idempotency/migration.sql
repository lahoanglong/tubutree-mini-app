-- Phase 1: thêm idempotencyKey cho orders (chống double-submit place-order)
ALTER TABLE "orders" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");
