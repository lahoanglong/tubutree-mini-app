-- C-060 / A2-004 (Q-04): sổ cái Ví Tubu. Trước đây walletBalance (tiền thật, rút được) bị cộng/trừ
-- ở nhiều nơi mà không có lịch sử. Additive: thêm enum + bảng, không đụng cột cũ.
-- Bắt đầu ghi sổ từ ngày triển khai: mỗi user có số dư <> 0 nhận đúng 1 dòng OPENING bằng số dư
-- hiện tại (không dựng lại lịch sử cũ). Sau migration bất biến users.walletBalance = SUM(delta)
-- đúng cho mọi user; code mới phải lên CÙNG đợt để mọi biến động sau đó đều ghi sổ.

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('OPENING', 'ORDER_PAY', 'ORDER_REFUND', 'COMMISSION_PAYOUT', 'CASHBACK', 'WITHDRAW', 'WITHDRAW_REFUND', 'XU_CONVERT', 'MERGE_IN', 'MERGE_OUT', 'ADJUST');

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_userId_type_refId_key" ON "wallet_transactions"("userId", "type", "refId");

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill số dư đầu kỳ. Khoá users trong lúc chụp số dư để không lọt biến động của code cũ đang
-- chạy giữa SELECT và INSERT. refId = 'OPENING' để unique index chặn dòng đầu kỳ thứ hai.
-- Số dư âm (nếu dữ liệu cũ có) vẫn ghi nguyên để tổng sổ khớp số dư; reconcile sẽ chỉ ra.
LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO "wallet_transactions" ("id", "userId", "delta", "balanceAfter", "type", "refType", "refId", "reason", "createdAt")
SELECT 'wtx_open_' || u."id", u."id", u."walletBalance", u."walletBalance", 'OPENING', 'OPENING', 'OPENING',
       'Số dư đầu kỳ', CURRENT_TIMESTAMP
FROM "users" u
WHERE u."walletBalance" <> 0;
