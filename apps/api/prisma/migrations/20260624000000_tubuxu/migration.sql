-- TubuXu: tiền tệ tiêu trong app. Ví (tiền thật) đổi sang TubuXu ×1.2; TubuXu không rút được.
-- Kèm: phí rút ngân hàng (payouts.fee), PaymentMethod XU, sổ cái coin_transactions.

-- 1) Số dư TubuXu trên user.
ALTER TABLE "users" ADD COLUMN "coinsBalance" INTEGER NOT NULL DEFAULT 0;

-- 2) Phí chuyển khoản ngân hàng khi rút Ví (amount = số thực nhận sau phí).
ALTER TABLE "payouts" ADD COLUMN "fee" INTEGER NOT NULL DEFAULT 0;

-- 3) Phương thức thanh toán bằng TubuXu (không dùng trong cùng migration nên ADD VALUE an toàn).
ALTER TYPE "PaymentMethod" ADD VALUE 'XU';

-- 4) Sổ cái TubuXu — bất biến coinsBalance == SUM(delta) của user (như points_transactions).
CREATE TABLE "coin_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coin_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coin_transactions_userId_idx" ON "coin_transactions"("userId");

ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Chống thưởng giới thiệu 2 lần: mỗi reason REFERRAL (đã nhúng refereeId) chỉ insert 1 lần.
--    grantReferralCoins bắt P2002 → bail idempotent (mirror points_transactions_*_unique).
CREATE UNIQUE INDEX "coin_transactions_referral_unique"
  ON "coin_transactions" ("reason")
  WHERE "refType" = 'REFERRAL';
