-- Lưu TỪNG lần thử thanh toán cổng, thay vì chỉ giữ lần mới nhất ở orders.paymentTxnId
-- (P2, docs/2026-09-08-review-progress.md).
-- app_trans_id của ZaloPay có tiền tố NGÀY (yymmdd_<order code>) nên mỗi ngày bấm thanh toán
-- lại sinh mã khác. Khi đó paymentTxnId bị ghi đè bằng mã mới; nếu khách hoàn tất giao dịch
-- của lần thử CŨ, callback mang mã cũ → tra theo paymentTxnId không khớp đơn nào, handler im
-- lặng trả success trong khi tiền ĐÃ bị thu và đơn vẫn UNPAID.
CREATE TABLE IF NOT EXISTS "payment_attempts" (
    "id"         TEXT NOT NULL,
    "orderId"    TEXT NOT NULL,
    "provider"   TEXT NOT NULL,
    "appTransId" TEXT NOT NULL,
    "amount"     INTEGER NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_appTransId_key" ON "payment_attempts"("appTransId");
CREATE INDEX IF NOT EXISTS "payment_attempts_orderId_idx" ON "payment_attempts"("orderId");

ALTER TABLE "payment_attempts"
  ADD CONSTRAINT "payment_attempts_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
