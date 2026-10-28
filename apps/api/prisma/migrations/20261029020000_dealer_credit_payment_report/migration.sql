-- Đại lý báo đã chuyển khoản trả nợ: lưu thành dòng chờ kế toán xử lý thay vì chỉ một tin nhắn. Chỉ thêm bảng mới.

-- CreateEnum
CREATE TYPE "DealerCreditPaymentReportStatus" AS ENUM ('REPORTED', 'RECORDED', 'DISMISSED');

-- CreateTable
CREATE TABLE "dealer_credit_payment_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "status" "DealerCreditPaymentReportStatus" NOT NULL DEFAULT 'REPORTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolveNote" TEXT,

    CONSTRAINT "dealer_credit_payment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dealer_credit_payment_reports_status_createdAt_idx" ON "dealer_credit_payment_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "dealer_credit_payment_reports_userId_status_idx" ON "dealer_credit_payment_reports"("userId", "status");
