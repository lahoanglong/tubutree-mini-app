-- C-015 (Q-13): gói giao định kỳ trả bằng COD / Ví Tubu / chuyển khoản. Additive: gói đang có giữ COD
-- (đúng hành vi trước đây), không cần backfill.
ALTER TABLE "subscriptions" ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'COD';
