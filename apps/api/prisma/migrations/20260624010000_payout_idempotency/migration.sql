-- Chống double-submit rút tiền: 2 lần POST /wallet/withdraw cùng Idempotency-Key (double-tap/
-- retry sau timeout) → lần 2 ăn unique violation → service trả lại Payout đã tạo (không trừ ví lần 2).
ALTER TABLE "payouts" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "payouts_idempotencyKey_key" ON "payouts"("idempotencyKey");
