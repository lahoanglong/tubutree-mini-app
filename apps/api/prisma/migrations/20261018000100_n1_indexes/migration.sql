-- lockedOrderPoints / tra cứu referral theo (userId, refId) và các đường gộp khách vãng lai / xoá user
-- quét flash_sale_purchases theo userId (unique hiện có bắt đầu bằng flashSaleItemId nên không phục vụ được).
-- Không CONCURRENTLY vì migration chạy trong transaction; bảng còn gần rỗng trước launch.
CREATE INDEX IF NOT EXISTS "points_transactions_userId_refId_idx" ON "points_transactions"("userId", "refId");
CREATE INDEX IF NOT EXISTS "flash_sale_purchases_userId_idx" ON "flash_sale_purchases"("userId");
