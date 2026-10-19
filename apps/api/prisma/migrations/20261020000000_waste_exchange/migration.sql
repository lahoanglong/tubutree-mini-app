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


-- BEGIN WASTE HAND-WRITTEN CONSTRAINTS
-- Ràng buộc viết tay §11.3: index unique có điều kiện và CHECK mà Prisma schema không biểu diễn được, chạy lại không lỗi.

CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_recycle_ref_key"
ON "points_transactions" ("refId")
WHERE "refType" = 'RECYCLE';

CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_recycle_reverse_key"
ON "points_transactions" ("refId")
WHERE "refType" = 'RECYCLE_REVERSED';

CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_gift_refund_key"
ON "points_transactions" ("refId")
WHERE "refType" = 'GIFT_REFUND';

CREATE UNIQUE INDEX IF NOT EXISTS "waste_points_one_warehouse_key"
ON "waste_points" ("kind")
WHERE "kind" = 'WAREHOUSE';

CREATE UNIQUE INDEX IF NOT EXISTS "waste_point_staff_one_owner_key"
ON "waste_point_staff" ("pointId")
WHERE "role" = 'OWNER' AND "isActive";

DO $$
BEGIN
  ALTER TABLE "waste_items" ADD CONSTRAINT "waste_items_hazardous_not_active_chk" CHECK (NOT ("hazardous" AND "status" = 'ACTIVE'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_items" ADD CONSTRAINT "waste_items_units_per_point_chk" CHECK ("unitsPerPoint" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_items" ADD CONSTRAINT "waste_items_points_per_group_chk" CHECK ("pointsPerGroup" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_items" ADD CONSTRAINT "waste_items_drops_chk" CHECK ("dropsPerUnit" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_items" ADD CONSTRAINT "waste_items_daily_cap_chk" CHECK ("dailyCapQty" IS NULL OR "dailyCapQty" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_items" ADD CONSTRAINT "waste_items_monthly_cap_chk" CHECK ("monthlyCapQty" IS NULL OR "monthlyCapQty" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_points" ADD CONSTRAINT "waste_points_partner_quota_chk" CHECK ("kind" = 'WAREHOUSE' OR "monthlyQuotaPoints" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_points" ADD CONSTRAINT "waste_points_warehouse_active_chk" CHECK ("kind" <> 'WAREHOUSE' OR "status" = 'ACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_requests" ADD CONSTRAINT "waste_requests_expires_at_chk" CHECK (NOT ("status" = 'OPEN' AND "orderId" IS NOT NULL AND "expiresAt" IS NOT NULL) AND ("method" <> 'MAIL_IN' OR "status" <> 'IN_TRANSIT' OR "expiresAt" IS NULL) AND ("method" <> 'PICKUP' OR "status" <> 'IN_TRANSIT' OR "expiresAt" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_request_lines" ADD CONSTRAINT "waste_request_lines_received_chk" CHECK ("receivedQty" IS NULL OR ("receivedQty" >= 0 AND "receivedQty" <= "declaredQty"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_request_lines" ADD CONSTRAINT "waste_request_lines_declared_chk" CHECK ("declaredQty" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_point_usage" ADD CONSTRAINT "waste_point_usage_points_chk" CHECK ("pointsUsed" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_gifts" ADD CONSTRAINT "waste_gifts_stock_chk" CHECK ("stock" IS NULL OR "stock" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_gifts" ADD CONSTRAINT "waste_gifts_voucher_fields_chk" CHECK ("kind" <> 'VOUCHER' OR ("voucherType" IS NOT NULL AND "voucherValue" IS NOT NULL AND "voucherValidDays" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_gifts" ADD CONSTRAINT "waste_gifts_points_cost_chk" CHECK ("kind" = 'TREE' OR "pointsCost" BETWEEN 1 AND 2000000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "waste_gift_redemptions" ADD CONSTRAINT "waste_gift_redemptions_ready_chk" CHECK ("status" <> 'READY' OR ("code" IS NOT NULL AND "giftKind" IN ('SEED_PACK', 'GIFT')));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- END WASTE HAND-WRITTEN CONSTRAINTS

-- BEGIN WASTE SEED DATA
-- Reference rows (spec 11.7): prod runs migrate deploy, never seed.ts, so the migration carries them. Idempotent.
INSERT INTO "waste_items" ("id", "code", "name", "unitLabel", "unitsPerPoint", "pointsPerGroup", "dropsPerUnit", "dailyCapQty", "monthlyCapQty", "status", "prepInstructions", "sortOrder", "hazardous", "updatedAt") VALUES
  ('wi-carton', 'CARTON', 'Thùng carton cũ', 'thùng', 1, 1000, 0, 10, 60, 'ACTIVE', 'Gấp phẳng, giữ khô và sạch.', 10, false, NOW()),
  ('wi-bubble-wrap', 'BUBBLE_WRAP', 'Nilon chống sốc', 'túi lớn', 1, 1000, 0, 10, 60, 'ACTIVE', 'Túi còn nguyên, khô, không dính băng keo hay nhãn.', 20, false, NOW()),
  ('wi-milk-carton', 'MILK_CARTON', 'Vỏ hộp sữa sạch', 'vỏ', 5, 1000, 0, 50, 300, 'ACTIVE', 'Rửa sạch, để ráo, ép dẹt.', 30, false, NOW()),
  ('wi-tubu-bottle', 'TUBU_BOTTLE', 'Vỏ chai, hộp Tubu Tree', 'vỏ', 1, 2000, 2, NULL, 20, 'ACTIVE', 'Vỏ chai hoặc hộp Tubu Tree đã dùng hết, rửa sạch, để ráo.', 40, false, NOW()),
  ('wi-battery', 'BATTERY', 'Pin đã dùng', 'viên', 1, 1000, 0, NULL, NULL, 'COMING_SOON', NULL, 50, true, NOW())
ON CONFLICT DO NOTHING;
INSERT INTO "waste_gifts" ("id", "kind", "name", "description", "label", "pointsCost", "status", "sortOrder", "voucherType", "voucherValue", "voucherMinOrder", "voucherMaxDiscount", "voucherValidDays", "updatedAt") VALUES
  ('reward-freeship', 'VOUCHER', 'Miễn phí vận chuyển', 'Miễn phí vận chuyển cho 1 đơn từ 99.000đ — hữu ích khi đơn chưa đạt mức freeship của shop.', 'Phổ biến', 20000, 'ACTIVE', 10, 'FREESHIP', 0, 99000, NULL, 30, NOW()),
  ('reward-discount-50k', 'VOUCHER', 'Giảm 50.000đ', 'Giảm ngay 50.000đ cho đơn hàng từ 300.000đ', 'Tiết kiệm', 50000, 'ACTIVE', 20, 'AMOUNT', 50000, 300000, NULL, 30, NOW()),
  ('reward-percent-15pct', 'VOUCHER', 'Giảm 15%', 'Giảm 15% tối đa 80.000đ cho đơn hàng từ 250.000đ', 'Đặc quyền', 75000, 'ACTIVE', 30, 'PERCENT', 15, 250000, 80000, 30, NOW()),
  ('reward-discount-100k', 'VOUCHER', 'Giảm 100.000đ', 'Giảm ngay 100.000đ cho đơn hàng từ 600.000đ', 'HOT', 100000, 'ACTIVE', 40, 'AMOUNT', 100000, 600000, NULL, 30, NOW()),
  ('gift-tree', 'TREE', 'Góp quỹ trồng cây', 'Dùng Điểm Xanh góp vào quỹ trồng cây của Tubu Tree.', NULL, 0, 'ACTIVE', 50, NULL, NULL, NULL, NULL, NULL, NOW())
ON CONFLICT DO NOTHING;
-- END WASTE SEED DATA

-- BEGIN WASTE CONFIG ROWS
-- Dòng cấu hình mặc định của Đổi rác lấy quà: prod chạy migrate deploy chứ không chạy seed.ts. Chạy lại không đổi gì.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('waste.enabled', 'false'::jsonb, 'Cờ tổng của chương trình Đổi rác lấy quà, tắt thì khách không tạo được yêu cầu mới và bàn đại lý bị chặn, kho vẫn xử lý yêu cầu đã có.', 'waste', NOW()),
  ('waste.lane_dropoff_enabled', 'true'::jsonb, 'Bật cách giao Mang tới điểm nhận cho yêu cầu mới.', 'waste', NOW()),
  ('waste.lane_mailin_enabled', 'true'::jsonb, 'Bật cách giao Gửi về kho cho yêu cầu mới.', 'waste', NOW()),
  ('waste.lane_pickup_enabled', 'false'::jsonb, 'Bật cách giao Thu kèm đơn cho yêu cầu mới, còn cần cờ Gomdon hiện có.', 'waste', NOW()),
  ('waste.mailin_min_points', '15000'::jsonb, 'Số Điểm Xanh tối thiểu của một gói gửi kho, không được lớn hơn trần điểm tháng của khách.', 'waste', NOW()),
  ('waste.pickup_min_points', '10000'::jsonb, 'Số Điểm Xanh tối thiểu của một gói thu kèm đơn, không được lớn hơn trần điểm tháng của khách.', 'waste', NOW()),
  ('waste.customer_monthly_cap_points', '60000'::jsonb, 'Trần Điểm Xanh mỗi khách được cộng từ đổi rác trong một tháng.', 'waste', NOW()),
  ('waste.max_open_requests', '3'::jsonb, 'Số yêu cầu đổi rác một khách được mở cùng lúc.', 'waste', NOW()),
  ('waste.request_hold_days', '7'::jsonb, 'Số ngày giữ chỗ một yêu cầu và chờ khách nhập mã vận đơn.', 'waste', NOW()),
  ('waste.pickup_wait_days', '14'::jsonb, 'Số ngày chờ hàng thu kèm về kho sau khi đơn mua đã giao.', 'waste', NOW()),
  ('waste.in_transit_review_days', '30'::jsonb, 'Yêu cầu gửi kho đang vận chuyển quá ngần này ngày thì vào danh sách admin xem lại.', 'waste', NOW()),
  ('waste.mailin_max_weight_kg', '20'::jsonb, 'Khối lượng tối đa của mỗi kiện gửi kho, tính bằng kg, theo giới hạn của hãng chuyển phát.', 'waste', NOW()),
  ('waste.mailin_max_edge_cm', '50'::jsonb, 'Cạnh dài tối đa của mỗi kiện gửi kho, tính bằng cm.', 'waste', NOW()),
  ('waste.shortfall_lock_pct', '50'::jsonb, 'Yêu cầu hoàn tất mà điểm cộng chưa tới (100 trừ ngần này) phần trăm điểm ước tính thì tính là một lần nhận thiếu.', 'waste', NOW()),
  ('waste.shortfall_lock_streak', '3'::jsonb, 'Số lần nhận thiếu liền nhau thì khoá đường gửi kho và thu kèm đơn của khách.', 'waste', NOW()),
  ('waste.staff_daily_cap_points', '1000000'::jsonb, 'Trần Điểm Xanh mỗi nhân viên kho hoặc điểm nhận được xác nhận trong một ngày.', 'waste', NOW()),
  ('waste.gift_claim_days', '60'::jsonb, 'Số ngày khách được nhận quà bằng mã, quá hạn thì lượt đổi vào danh sách admin xem lại.', 'waste', NOW()),
  ('waste.point_inactive_days', '60'::jsonb, 'Điểm nhận đối tác không có lượt xác nhận nào quá ngần này ngày kể từ lần xác nhận cuối hoặc lần kích hoạt thì bị ẩn khỏi danh sách khách.', 'waste', NOW()),
  ('waste.mailin_fee_table', '{"zones":[],"defaultZone":{"name":"Toàn quốc","low":30000,"high":85000}}'::jsonb, 'Bảng ước tính phí ship gửi kho theo vùng tỉnh, mỗi vùng có phí thấp và phí cao, cộng một vùng mặc định cho tỉnh chưa xếp.', 'waste', NOW()),
  ('waste.alert_thresholds', '{"quotaPacePct":60,"quotaPaceDays":10,"fullMatchPct":95,"fullMatchMinSample":10,"repeatCustomerCount":3,"repeatCustomerDays":7,"avgUnitsFactor":2,"lookupMissCount":10,"lookupMissDays":1,"staffDirectCount":5,"staffDirectDays":7}'::jsonb, 'Ngưỡng cảnh báo bất thường về điểm nhận và người xác nhận, chỉ để admin xem, không tự khoá ai.', 'waste', NOW()),
  ('waste.rules_text', '""'::jsonb, 'Thể lệ công khai của chương trình, tối đa 8000 ký tự, để trống thì mục Thể lệ hiện ghi chú sắp có.', 'waste', NOW())
ON CONFLICT ("key") DO NOTHING;
-- END WASTE CONFIG ROWS

-- BEGIN WASTE TEMPLATES
-- Mười mẫu tin INAPP của Đổi rác lấy quà (bản prod chỉ chạy migration, không chạy seed).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-waste-parcel-received', 'WASTE_PARCEL_RECEIVED', 'INAPP', 'Kho Tubu đã nhận kiện của yêu cầu {{code}}. Tubu sẽ đếm và báo bạn kết quả cộng Điểm Xanh.'),
  ('nt-waste-points-credited', 'WASTE_POINTS_CREDITED', 'INAPP', 'Yêu cầu {{code}} đã đếm xong. {{result}}.'),
  ('nt-waste-request-rejected', 'WASTE_REQUEST_REJECTED', 'INAPP', 'Yêu cầu {{code}} chưa được nhận: {{reason}}. Bạn xem chi tiết trong mục Đổi rác.'),
  ('nt-waste-request-expired', 'WASTE_REQUEST_EXPIRED', 'INAPP', 'Yêu cầu {{code}} đã đóng: {{detail}}.'),
  ('nt-waste-pickup-started', 'WASTE_PICKUP_STARTED', 'INAPP', 'Đơn mua của bạn đã giao. Nếu người giao hàng đã nhận phần rác của yêu cầu {{code}}, kiện sẽ về kho Tubu. Tubu chờ kiện tới khoảng ngày {{until}}.'),
  ('nt-waste-pickup-cancelled', 'WASTE_PICKUP_CANCELLED', 'INAPP', 'Đơn mua bị huỷ nên yêu cầu thu kèm rác {{code}} cũng đã đóng. Bạn tạo yêu cầu mới trong mục Đổi rác khi cần.'),
  ('nt-waste-points-reversed', 'WASTE_POINTS_REVERSED', 'INAPP', 'Tubu đã thu hồi {{points}} Điểm Xanh của yêu cầu {{code}}. Lý do: {{reason}}.'),
  ('nt-waste-ship-locked', 'WASTE_SHIP_LOCKED', 'INAPP', 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn. Bạn vẫn mang rác tới điểm nhận được. Yêu cầu thu kèm chưa gắn đơn (nếu có) sẽ được huỷ. Cần hỗ trợ, liên hệ Tubu Tree.'),
  ('nt-waste-gift-cancelled', 'WASTE_GIFT_CANCELLED', 'INAPP', 'Lượt đổi quà {{gift}} đã bị huỷ.{{points_note}}'),
  ('nt-waste-perk-reviewed', 'WASTE_PERK_REVIEWED', 'INAPP', 'Ưu đãi riêng của điểm nhận {{point}}: {{result}}.')
ON CONFLICT DO NOTHING;
-- END WASTE TEMPLATES
