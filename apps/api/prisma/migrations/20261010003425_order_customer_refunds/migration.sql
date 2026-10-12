-- CreateEnum
CREATE TYPE "CustomerRefundMethod" AS ENUM ('WALLET', 'MANUAL_TRANSFER');

-- CreateEnum
CREATE TYPE "CustomerRefundStatus" AS ENUM ('PENDING', 'COMPLETED');

-- CreateTable
CREATE TABLE "order_customer_refunds" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "phone" TEXT,
    "recipientName" TEXT,
    "customerUserId" TEXT,
    "method" "CustomerRefundMethod" NOT NULL,
    "status" "CustomerRefundStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "bankRef" TEXT,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_customer_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_customer_refunds_orderId_key" ON "order_customer_refunds"("orderId");

-- CreateIndex
CREATE INDEX "order_customer_refunds_status_createdAt_idx" ON "order_customer_refunds"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "order_customer_refunds" ADD CONSTRAINT "order_customer_refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
