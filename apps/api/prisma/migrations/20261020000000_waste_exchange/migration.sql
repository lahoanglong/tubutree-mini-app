-- Đổi rác lấy quà (spec 2026-10-17, mục 11). Chỉ THÊM: 14 kiểu enum và 12 bảng waste_*, không đổi hay xoá gì của bảng cũ.
-- Bảng cho điểm nhận, yêu cầu, nhật ký, hàng không rõ chủ, cờ khách và kho quà. Ràng buộc viết tay, dữ liệu khởi tạo, cấu hình và mẫu thông báo nối ở các phần dưới.

-- CreateEnum
CREATE TYPE "WasteItemStatus" AS ENUM ('ACTIVE', 'COMING_SOON', 'HIDDEN');

-- CreateEnum
CREATE TYPE "WastePointKind" AS ENUM ('WAREHOUSE', 'PARTNER');

-- CreateEnum
CREATE TYPE "WastePointStatus" AS ENUM ('ACTIVE', 'PAUSED', 'PENDING');

-- CreateEnum
CREATE TYPE "WastePointStaffRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "WasteMethod" AS ENUM ('DROP_OFF', 'MAIL_IN', 'PICKUP');

-- CreateEnum
CREATE TYPE "WasteRequestStatus" AS ENUM ('OPEN', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WasteCloseReason" AS ENUM ('HOLD_EXPIRED', 'PICKUP_NO_SHOW', 'PICKUP_NOT_DISPATCHED', 'LOST', 'LOST_AT_WAREHOUSE', 'SHIP_LOCKED', 'ORDER_CANCELLED');

-- CreateEnum
CREATE TYPE "WasteRejectionReason" AS ENUM ('WET', 'DIRTY', 'FOREIGN_OBJECT', 'WRONG_TYPE', 'DAMAGED', 'NOT_ACCEPTED', 'OVERSIZE', 'HAZARDOUS', 'UNPAID_POSTAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "WasteShortfallReason" AS ENUM ('WET', 'DIRTY', 'FOREIGN_OBJECT', 'WRONG_TYPE', 'DAMAGED', 'NOT_ACCEPTED', 'OTHER');

-- CreateEnum
CREATE TYPE "WasteActorRole" AS ENUM ('CUSTOMER', 'POINT_STAFF', 'STAFF', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WasteUnmatchedStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WasteGiftKind" AS ENUM ('VOUCHER', 'TREE', 'SEED_PACK', 'GIFT');

-- CreateEnum
CREATE TYPE "WasteGiftStatus" AS ENUM ('ACTIVE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "WasteGiftRedemptionStatus" AS ENUM ('READY', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "waste_items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "unitsPerPoint" INTEGER NOT NULL,
    "pointsPerGroup" INTEGER NOT NULL,
    "dropsPerUnit" INTEGER NOT NULL DEFAULT 0,
    "dailyCapQty" INTEGER,
    "monthlyCapQty" INTEGER,
    "status" "WasteItemStatus" NOT NULL DEFAULT 'HIDDEN',
    "prepInstructions" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "gramsPerUnit" INTEGER,
    "hazardous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_points" (
    "id" TEXT NOT NULL,
    "kind" "WastePointKind" NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "provinceName" TEXT NOT NULL,
    "communeCode" TEXT NOT NULL,
    "communeName" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "openingHours" JSONB NOT NULL DEFAULT '{}',
    "status" "WastePointStatus" NOT NULL DEFAULT 'PENDING',
    "monthlyQuotaPoints" INTEGER,
    "perkText" TEXT,
    "perkPendingText" TEXT,
    "giftHandoverEnabled" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_point_items" (
    "pointId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "waste_point_items_pkey" PRIMARY KEY ("pointId","itemId")
);

-- CreateTable
CREATE TABLE "waste_point_staff" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WastePointStaffRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_point_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_point_usage" (
    "pointId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "pointsUsed" INTEGER NOT NULL DEFAULT 0,
    "confirmations" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "waste_point_usage_pkey" PRIMARY KEY ("pointId","monthKey")
);

-- CreateTable
CREATE TABLE "waste_requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "WasteMethod" NOT NULL,
    "status" "WasteRequestStatus" NOT NULL DEFAULT 'OPEN',
    "pointId" TEXT NOT NULL,
    "orderId" TEXT,
    "carrier" TEXT,
    "trackingCode" TEXT,
    "trackingNorm" TEXT,
    "trackingConflict" BOOLEAN NOT NULL DEFAULT false,
    "estimatedPoints" INTEGER NOT NULL,
    "estimatedDrops" INTEGER NOT NULL DEFAULT 0,
    "capDayKey" TEXT NOT NULL,
    "capMonthKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "inTransitAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" "WasteCloseReason",
    "confirmedByUserId" TEXT,
    "pointsAwarded" INTEGER,
    "dropsAwarded" INTEGER,
    "receivedWeightGrams" INTEGER,
    "carrierCostVnd" INTEGER,
    "rejectionReason" "WasteRejectionReason",
    "rejectionNote" VARCHAR(500),
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversalReason" TEXT,
    "reversalShortfallPoints" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "unitsPerPoint" INTEGER NOT NULL,
    "pointsPerGroup" INTEGER NOT NULL,
    "dropsPerUnit" INTEGER NOT NULL,
    "gramsPerUnit" INTEGER,
    "declaredQty" INTEGER NOT NULL,
    "receivedQty" INTEGER,
    "shortfallReason" "WasteShortfallReason",
    "pointsAwarded" INTEGER,

    CONSTRAINT "waste_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "requestId" TEXT,
    "pointId" TEXT,
    "giftRedemptionId" TEXT,
    "actorUserId" TEXT,
    "actorRole" "WasteActorRole" NOT NULL,
    "meta" JSONB,

    CONSTRAINT "waste_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_unmatched_parcels" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "carrier" TEXT,
    "trackingCode" TEXT,
    "trackingNorm" TEXT,
    "description" VARCHAR(200) NOT NULL,
    "reason" TEXT NOT NULL,
    "relatedRequestId" TEXT,
    "status" "WasteUnmatchedStatus" NOT NULL DEFAULT 'OPEN',
    "matchedRequestId" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolveNote" TEXT,

    CONSTRAINT "waste_unmatched_parcels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_user_flags" (
    "userId" TEXT NOT NULL,
    "shipLockedAt" TIMESTAMP(3),
    "shipUnlockedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "reason" TEXT,
    "setByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_user_flags_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "waste_gifts" (
    "id" TEXT NOT NULL,
    "kind" "WasteGiftKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "label" TEXT,
    "pointsCost" INTEGER NOT NULL,
    "status" "WasteGiftStatus" NOT NULL DEFAULT 'HIDDEN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "stock" INTEGER,
    "claimInstructions" TEXT,
    "voucherType" "CouponType",
    "voucherValue" INTEGER,
    "voucherMinOrder" INTEGER,
    "voucherMaxDiscount" INTEGER,
    "voucherValidDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waste_gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_gift_redemptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,
    "giftKind" "WasteGiftKind" NOT NULL,
    "giftName" TEXT NOT NULL,
    "pointsCost" INTEGER NOT NULL,
    "status" "WasteGiftRedemptionStatus" NOT NULL,
    "code" TEXT,
    "couponId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "claimExpiresAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledByUserId" TEXT,
    "fulfilledPointId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelReason" TEXT,
    "refundedPoints" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_gift_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waste_items_code_key" ON "waste_items"("code");

-- CreateIndex
CREATE INDEX "waste_items_status_sortOrder_idx" ON "waste_items"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "waste_points_kind_status_idx" ON "waste_points"("kind", "status");

-- CreateIndex
CREATE INDEX "waste_points_provinceCode_status_idx" ON "waste_points"("provinceCode", "status");

-- CreateIndex
CREATE INDEX "waste_point_items_itemId_idx" ON "waste_point_items"("itemId");

-- CreateIndex
CREATE INDEX "waste_point_staff_userId_isActive_idx" ON "waste_point_staff"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "waste_point_staff_pointId_userId_key" ON "waste_point_staff"("pointId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "waste_requests_code_key" ON "waste_requests"("code");

-- CreateIndex
CREATE UNIQUE INDEX "waste_requests_orderId_key" ON "waste_requests"("orderId");

-- CreateIndex
CREATE INDEX "waste_requests_trackingNorm_idx" ON "waste_requests"("trackingNorm");

-- CreateIndex
CREATE INDEX "waste_requests_userId_status_idx" ON "waste_requests"("userId", "status");

-- CreateIndex
CREATE INDEX "waste_requests_status_method_idx" ON "waste_requests"("status", "method");

-- CreateIndex
CREATE INDEX "waste_requests_capMonthKey_idx" ON "waste_requests"("capMonthKey");

-- CreateIndex
CREATE INDEX "waste_requests_confirmedByUserId_completedAt_idx" ON "waste_requests"("confirmedByUserId", "completedAt");

-- CreateIndex
CREATE INDEX "waste_requests_pointId_status_idx" ON "waste_requests"("pointId", "status");

-- CreateIndex
CREATE INDEX "waste_requests_status_expiresAt_idx" ON "waste_requests"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "waste_requests_userId_idempotencyKey_key" ON "waste_requests"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "waste_request_lines_itemId_idx" ON "waste_request_lines"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "waste_request_lines_requestId_itemId_key" ON "waste_request_lines"("requestId", "itemId");

-- CreateIndex
CREATE INDEX "waste_events_requestId_createdAt_idx" ON "waste_events"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "waste_events_pointId_kind_createdAt_idx" ON "waste_events"("pointId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "waste_events_actorUserId_kind_createdAt_idx" ON "waste_events"("actorUserId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "waste_unmatched_parcels_status_receivedAt_idx" ON "waste_unmatched_parcels"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "waste_unmatched_parcels_trackingNorm_idx" ON "waste_unmatched_parcels"("trackingNorm");

-- CreateIndex
CREATE INDEX "waste_gifts_status_sortOrder_idx" ON "waste_gifts"("status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "waste_gift_redemptions_code_key" ON "waste_gift_redemptions"("code");

-- CreateIndex
CREATE INDEX "waste_gift_redemptions_status_claimExpiresAt_idx" ON "waste_gift_redemptions"("status", "claimExpiresAt");

-- CreateIndex
CREATE INDEX "waste_gift_redemptions_userId_createdAt_idx" ON "waste_gift_redemptions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "waste_gift_redemptions_userId_idempotencyKey_key" ON "waste_gift_redemptions"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "waste_point_items" ADD CONSTRAINT "waste_point_items_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "waste_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_point_items" ADD CONSTRAINT "waste_point_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "waste_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_point_staff" ADD CONSTRAINT "waste_point_staff_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "waste_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_point_staff" ADD CONSTRAINT "waste_point_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_point_usage" ADD CONSTRAINT "waste_point_usage_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "waste_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_requests" ADD CONSTRAINT "waste_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_requests" ADD CONSTRAINT "waste_requests_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "waste_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_requests" ADD CONSTRAINT "waste_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_request_lines" ADD CONSTRAINT "waste_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "waste_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_request_lines" ADD CONSTRAINT "waste_request_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "waste_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_user_flags" ADD CONSTRAINT "waste_user_flags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_gift_redemptions" ADD CONSTRAINT "waste_gift_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_gift_redemptions" ADD CONSTRAINT "waste_gift_redemptions_giftId_fkey" FOREIGN KEY ("giftId") REFERENCES "waste_gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

