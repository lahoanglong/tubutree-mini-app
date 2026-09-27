-- A1-03 (docs/audit-2026-09/01-ia-navigation.md): nút "Gửi yêu cầu xoá tài khoản" trong miniapp
-- chỉ hiện snackbar giả — không có endpoint xoá tài khoản nào ở BE. Bảng này ghi nhận YÊU CẦU
-- (không phải xoá thật) để CSKH/admin xử lý thủ công, mirror cấu trúc tối giản của return_requests
-- (không FK cứng, chỉ userId + index để admin truy vấn).

-- CreateEnum
CREATE TYPE "AccountDeletionRequestStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "AccountDeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_deletion_requests_userId_idx" ON "account_deletion_requests"("userId");

-- CreateIndex
CREATE INDEX "account_deletion_requests_status_idx" ON "account_deletion_requests"("status");
