-- Chống double-credit cashback khi 2 postback cùng order_id chạy song song.
CREATE UNIQUE INDEX "cashback_transactions_merchantOrderId_key" ON "cashback_transactions"("merchantOrderId");
