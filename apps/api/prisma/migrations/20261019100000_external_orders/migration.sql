-- Gói extorders bước 1: nhận đơn Pancake ngoài app (sàn, chat, điện thoại) vào bảng riêng. Chưa cộng điểm; các bảng claim/attempt và
-- unique sổ điểm có sẵn để bước sau không phải đổi schema.

-- CreateEnum
CREATE TYPE "ExternalOrderSource" AS ENUM ('MARKETPLACE', 'CHAT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExternalOrderStatus" AS ENUM ('OPEN', 'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED', 'PARTIAL_RETURN', 'DELETED');

-- CreateEnum
CREATE TYPE "ExternalClaimKind" AS ENUM ('SCAN', 'PHONE');

-- CreateEnum
CREATE TYPE "ExternalClaimState" AS ENUM ('PENDING', 'REVIEW', 'HELD_NO_MEMBER', 'CREDITED', 'VOIDED', 'REVERSED', 'LAPSED');

-- CreateTable
CREATE TABLE "external_orders" (
    "id" TEXT NOT NULL,
    "pancakeOrderId" TEXT NOT NULL,
    "source" "ExternalOrderSource" NOT NULL,
    "channel" TEXT,
    "sourceKey" TEXT NOT NULL,
    "trackingCode" TEXT,
    "trackingCodes" TEXT[],
    "marketplaceOrderSn" TEXT,
    "phone" TEXT,
    "phoneLast3" TEXT,
    "goodsValue" INTEGER,
    "pancakeStatus" INTEGER,
    "status" "ExternalOrderStatus" NOT NULL DEFAULT 'OPEN',
    "pancakeInsertedAt" TIMESTAMP(3),
    "pancakeUpdatedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lastPayload" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_points_claims" (
    "id" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "ExternalClaimKind" NOT NULL,
    "state" "ExternalClaimState" NOT NULL DEFAULT 'PENDING',
    "ratePct" DECIMAL(6,4) NOT NULL,
    "multiplier" DECIMAL(6,3) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "countsForTier" BOOLEAN NOT NULL DEFAULT false,
    "claimedCode" TEXT,
    "releaseAt" TIMESTAMP(3),
    "holdUntil" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),
    "pointsTxId" TEXT,
    "voidReason" TEXT,
    "reviewReason" TEXT,
    "decidedById" TEXT,
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_points_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_claim_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "dayKey" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_claim_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_orders_pancakeOrderId_key" ON "external_orders"("pancakeOrderId");

-- CreateIndex
CREATE INDEX "external_orders_trackingCode_idx" ON "external_orders"("trackingCode");

-- CreateIndex
CREATE INDEX "external_orders_trackingCodes_idx" ON "external_orders" USING GIN ("trackingCodes");

-- CreateIndex
CREATE INDEX "external_orders_source_status_idx" ON "external_orders"("source", "status");

-- CreateIndex
CREATE INDEX "external_orders_sourceKey_idx" ON "external_orders"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "external_points_claims_externalOrderId_key" ON "external_points_claims"("externalOrderId");

-- CreateIndex
CREATE INDEX "external_points_claims_state_releaseAt_idx" ON "external_points_claims"("state", "releaseAt");

-- CreateIndex
CREATE INDEX "external_points_claims_state_holdUntil_idx" ON "external_points_claims"("state", "holdUntil");

-- CreateIndex
CREATE INDEX "external_points_claims_userId_createdAt_idx" ON "external_points_claims"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "external_points_claims_userId_dayKey_idx" ON "external_points_claims"("userId", "dayKey");

-- CreateIndex
CREATE INDEX "external_claim_attempts_userId_createdAt_idx" ON "external_claim_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "external_claim_attempts_result_createdAt_idx" ON "external_claim_attempts"("result", "createdAt");

-- AddForeignKey
ALTER TABLE "external_points_claims" ADD CONSTRAINT "external_points_claims_externalOrderId_fkey" FOREIGN KEY ("externalOrderId") REFERENCES "external_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Các index một phần (Prisma không khai báo được WHERE nên chỉ nằm ở SQL).
CREATE INDEX "external_orders_phone_idx" ON "external_orders" ("phone") WHERE "phone" IS NOT NULL;

CREATE UNIQUE INDEX "external_points_claims_code_key" ON "external_points_claims" ("claimedCode") WHERE "claimedCode" IS NOT NULL;

CREATE UNIQUE INDEX "external_claim_attempts_unmatched_key" ON "external_claim_attempts" ("code") WHERE "result" = 'UNMATCHED' AND "resolvedAt" IS NULL;

-- Mỗi claim chỉ được ghi sổ một lần cho mỗi lý do (kiểu 20260623010000_loyalty_credit_unique); refId = id claim.
CREATE UNIQUE INDEX "points_transactions_external_order_key" ON "points_transactions" ("reason", "refId") WHERE "refType" = 'EXTERNAL_ORDER' AND "refId" IS NOT NULL;
