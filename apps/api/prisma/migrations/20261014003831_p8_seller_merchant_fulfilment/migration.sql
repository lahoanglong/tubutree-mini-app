-- CreateEnum
CREATE TYPE "FulfilmentMode" AS ENUM ('TUBU', 'MERCHANT');

-- CreateEnum
CREATE TYPE "MerchantPayoutStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MerchantPayoutLineKind" AS ENUM ('SALE', 'REVERSAL');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "checkoutGroup" TEXT,
ADD COLUMN     "fulfiller" "FulfilmentMode" NOT NULL DEFAULT 'TUBU',
ADD COLUMN     "fulfillerStorefrontId" TEXT,
ADD COLUMN     "merchantAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "merchantCommissionPct" DECIMAL(5,4),
ADD COLUMN     "merchantSlaNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "storefrontId" TEXT;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "grossAmount" INTEGER,
ADD COLUMN     "taxWithheld" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "fulfilment" "FulfilmentMode" NOT NULL DEFAULT 'TUBU',
ADD COLUMN     "pancakeLinkCode" TEXT,
ALTER COLUMN "pancakeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "storefronts" ADD COLUMN     "commissionPct" DECIMAL(5,4),
ADD COLUMN     "freeShipFrom" INTEGER,
ADD COLUMN     "shippingFee" INTEGER;

-- AlterTable
ALTER TABLE "variations" ALTER COLUMN "pancakeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "merchant_payouts" (
    "id" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "MerchantPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "bankInfo" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "bankRef" TEXT,
    "note" TEXT,

    CONSTRAINT "merchant_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_payout_lines" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "kind" "MerchantPayoutLineKind" NOT NULL,
    "goodsAmount" INTEGER NOT NULL,
    "shippingFee" INTEGER NOT NULL,
    "commissionAmount" INTEGER NOT NULL,
    "codCollected" INTEGER NOT NULL,
    "netAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_payout_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "released_storefront_identifiers" (
    "value" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "released_storefront_identifiers_pkey" PRIMARY KEY ("value")
);

-- CreateIndex
CREATE INDEX "merchant_payouts_storefrontId_createdAt_idx" ON "merchant_payouts"("storefrontId", "createdAt");

-- CreateIndex
CREATE INDEX "merchant_payouts_status_createdAt_idx" ON "merchant_payouts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "merchant_payout_lines_payoutId_idx" ON "merchant_payout_lines"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payout_lines_orderId_kind_key" ON "merchant_payout_lines"("orderId", "kind");

-- CreateIndex
CREATE INDEX "orders_fulfillerStorefrontId_status_createdAt_idx" ON "orders"("fulfillerStorefrontId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_storefrontId_createdAt_idx" ON "orders"("storefrontId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_checkoutGroup_idx" ON "orders"("checkoutGroup");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "storefronts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_fulfillerStorefrontId_fkey" FOREIGN KEY ("fulfillerStorefrontId") REFERENCES "storefronts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payouts" ADD CONSTRAINT "merchant_payouts_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "storefronts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payout_lines" ADD CONSTRAINT "merchant_payout_lines_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "merchant_payouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payout_lines" ADD CONSTRAINT "merchant_payout_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D4 (docs/2026-10-14-merchant-fulfilment-design.md mục 9): mã Pancake giả "MCH_…" của sản phẩm đối tác về NULL, sản phẩm đó
-- thành đối tác tự giao. Chạy lại không đổi gì (điều kiện LIKE không còn khớp). '\_' = dấu gạch dưới thật trong LIKE.
UPDATE "products" SET "fulfilment" = 'MERCHANT'
 WHERE "pancakeId" LIKE 'MCH\_%'
    OR "id" IN (SELECT "productId" FROM "variations" WHERE "pancakeId" LIKE 'MCH\_%');
UPDATE "variations" SET "pancakeId" = NULL WHERE "pancakeId" LIKE 'MCH\_%';
UPDATE "products" SET "pancakeId" = NULL WHERE "pancakeId" LIKE 'MCH\_%';

-- Sản phẩm cũ đăng trên gian hàng không phải đối tác (CTV, gian hàng của admin): chủ gian hàng không có màn xử lý đơn tự giao
-- nên ngừng bán; checkout cũng không nhận hàng tự giao ngoài gian hàng MERCHANT.
UPDATE "products" p SET "isActive" = false
 WHERE p."fulfilment" = 'MERCHANT' AND p."isActive"
   AND NOT EXISTS (SELECT 1 FROM "storefronts" s WHERE s."id" = p."storefrontId" AND s."type" = 'MERCHANT');

-- Đơn cũ chưa từng lên Pancake mà chỉ gồm hàng đối tác tự giao của MỘT gian hàng đối tác (MERCHANT): chuyển cho gian hàng đó
-- xử lý. Đơn lẫn hàng Tubu, hoặc hàng trên gian hàng CTV/admin, giữ TUBU (đẩy Pancake chỉ gom dòng Pancake và gắn cờ cần xử lý
-- cho phần còn lại, admin xử lý tay).
UPDATE "orders" o
   SET "fulfiller" = 'MERCHANT', "fulfillerStorefrontId" = x."sid"
  FROM (
    SELECT oi."orderId", MIN(p."storefrontId") AS "sid", COUNT(DISTINCT p."storefrontId") AS "n",
           BOOL_AND(COALESCE(p."fulfilment" = 'MERCHANT' AND s."type" = 'MERCHANT', false)) AS "allMerchant"
      FROM "order_items" oi
      JOIN "variations" v ON v."id" = oi."variationId"
      JOIN "products" p ON p."id" = v."productId"
      LEFT JOIN "storefronts" s ON s."id" = p."storefrontId"
     GROUP BY oi."orderId"
  ) x
 WHERE o."id" = x."orderId" AND x."allMerchant" AND x."n" = 1
   AND o."pancakeOrderId" IS NULL AND o."fulfiller" = 'TUBU';

-- SELLER-5: gian hàng ghi công theo khoá ngoại. Slug là bất biến nên khớp thẳng; subdomain/tên miền đổi chủ được nên chỉ nhận
-- khi chủ gian hàng đúng là CTV được ghi công trên đơn.
UPDATE "orders" o SET "storefrontId" = s."id"
  FROM "storefronts" s
 WHERE o."storefrontId" IS NULL AND o."storefrontSlug" IS NOT NULL AND o."storefrontSlug" = s."slug";
UPDATE "orders" o SET "storefrontId" = s."id"
  FROM "storefronts" s
 WHERE o."storefrontId" IS NULL AND o."storefrontSlug" IS NOT NULL
   AND (o."storefrontSlug" = s."subdomain" OR o."storefrontSlug" = s."customDomain")
   AND o."referrerUserId" IS NOT NULL AND o."referrerUserId" = s."ownerUserId";

-- SELLER-10: hoa hồng trong lệnh rút ngân hàng CHƯA chuyển tiền không còn mang trạng thái PAID ("Đã trả"); chỉ lệnh admin
-- đánh dấu đã chuyển mới làm hoa hồng PAID. Khoản đang rút = APPROVED + payoutBatchId.
UPDATE "commissions" c SET "status" = 'APPROVED', "paidAt" = NULL
  FROM "payouts" p
 WHERE c."payoutBatchId" = p."id" AND c."status" = 'PAID' AND p."status" IN ('REQUESTED', 'APPROVED');
