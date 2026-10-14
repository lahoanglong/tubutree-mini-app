-- P5 (D2/D3): hàng đợi hoàn tiền chung (huỷ/trả về ngân hàng, tiền về muộn) và trả hàng theo dòng/số lượng.
-- Chỉ thêm cột có mặc định hoặc nullable. Khoá unique cũ (một khoản mỗi đơn) đổi thành (đơn, loại, khoá): mọi dòng
-- cũ là END_CUSTOMER với refKey rỗng nên vẫn duy nhất.

-- CreateEnum
CREATE TYPE "CustomerRefundKind" AS ENUM ('END_CUSTOMER', 'CANCEL', 'RETURN', 'LATE_PAYMENT');

-- AlterTable
ALTER TABLE "order_customer_refunds" ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNo" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "kind" "CustomerRefundKind" NOT NULL DEFAULT 'END_CUSTOMER',
ADD COLUMN     "refKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "order_customer_refunds_orderId_kind_refKey_key" ON "order_customer_refunds"("orderId", "kind", "refKey");

-- DropIndex
DROP INDEX "order_customer_refunds_orderId_key";

-- CreateIndex
CREATE INDEX "order_customer_refunds_userId_createdAt_idx" ON "order_customer_refunds"("userId", "createdAt");

-- AlterTable
ALTER TABLE "return_requests" ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNo" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "commissionReversed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "convertedPointsRefunded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fullReturn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pointsRefunded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsReversed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reasonCode" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedBy" TEXT,
ADD COLUMN     "refundAmount" INTEGER,
ADD COLUMN     "shippingRefund" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shopFault" BOOLEAN;

-- CreateIndex
CREATE INDEX "return_requests_orderId_idx" ON "return_requests"("orderId");

-- CreateTable
CREATE TABLE "return_request_items" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "refundAmount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "return_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_request_items_orderItemId_idx" ON "return_request_items"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "return_request_items_returnRequestId_orderItemId_key" ON "return_request_items"("returnRequestId", "orderItemId");

-- AddForeignKey
ALTER TABLE "return_request_items" ADD CONSTRAINT "return_request_items_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Yêu cầu đã duyệt trước bản này luôn đảo cả đơn (đơn đã RETURNED): đánh dấu để phần "đã hoàn ở các lần trả một
-- phần" không tính chúng.
UPDATE "return_requests" SET "fullReturn" = true WHERE "status" = 'APPROVED';

-- Lớp chặn thứ hai cho Điểm Xanh hoàn/thu hồi theo từng lần trả một phần (guard chính là lần lật REQUESTED → APPROVED).
CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_return_request_unique"
  ON "points_transactions" ("reason", "refId")
  WHERE "refType" = 'RETURN_REQUEST' AND "refId" IS NOT NULL;
