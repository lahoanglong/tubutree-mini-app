-- Mua chung / Group Buy (§6.14.8): nhóm mua giá ưu đãi, đủ người trước hạn → SUCCESS.

CREATE TYPE "GroupBuyStatus" AS ENUM ('OPEN', 'SUCCESS', 'FAILED');

CREATE TABLE "group_buys" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "targetSize" INTEGER NOT NULL,
    "currentSize" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" INTEGER NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "status" "GroupBuyStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_buys_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_buys_status_expiresAt_idx" ON "group_buys"("status", "expiresAt");
CREATE INDEX "group_buys_productId_idx" ON "group_buys"("productId");
ALTER TABLE "group_buys" ADD CONSTRAINT "group_buys_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_buys" ADD CONSTRAINT "group_buys_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "group_buy_members" (
    "id" TEXT NOT NULL,
    "groupBuyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_buy_members_pkey" PRIMARY KEY ("id")
);
-- Mỗi user 1 lần/nhóm (chống tham gia trùng / đếm sai size).
CREATE UNIQUE INDEX "group_buy_members_groupBuyId_userId_key" ON "group_buy_members"("groupBuyId", "userId");
CREATE INDEX "group_buy_members_userId_idx" ON "group_buy_members"("userId");
ALTER TABLE "group_buy_members" ADD CONSTRAINT "group_buy_members_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "group_buys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_buy_members" ADD CONSTRAINT "group_buy_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
