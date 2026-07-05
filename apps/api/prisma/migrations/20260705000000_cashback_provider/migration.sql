-- Cashback provider-agnostic: tag provider cho merchant + transaction; đổi idempotency key
-- từ merchantOrderId đơn lẻ sang composite (provider, merchantOrderId) để đa provider không đụng nhau.

-- 1) Tag provider (default 'accesstrade' → tự back-fill row cũ).
ALTER TABLE "cashback_merchants" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'accesstrade';
ALTER TABLE "cashback_transactions" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'accesstrade';

-- 2) Đổi unique: bỏ merchantOrderId đơn lẻ, tạo composite (provider, merchantOrderId).
DROP INDEX "cashback_transactions_merchantOrderId_key";
CREATE UNIQUE INDEX "cashback_transactions_provider_merchantOrderId_key"
  ON "cashback_transactions" ("provider", "merchantOrderId");
