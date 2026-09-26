-- CTV: bậc/mốc thưởng doanh số tháng (AffiliateService.getMilestones/claimMilestone).
--
-- 1) commissions.commissionableTotal — nền doanh số cho bậc/mốc: tổng item.total của các dòng CÓ
--    hưởng hoa hồng (rate > 0). Trước đây bậc/mốc cộng commissions.orderTotal (= order.total) nên
--    1 món nhỏ có hoa hồng + hàng bị chặn affiliate (affiliateBlocked) + phí ship vẫn tính hết vào
--    "doanh số giới thiệu" → mở khoá mốc 80tr bằng hàng không hưởng hoa hồng.
ALTER TABLE "commissions" ADD COLUMN     "commissionableTotal" INTEGER NOT NULL DEFAULT 0;

-- Backfill commission cũ theo đúng quy tắc createCommissionForOrder (rate hiện tại của variation,
-- loại product.affiliateBlocked). Xấp xỉ: nếu rate/cờ chặn đã đổi sau lúc đặt đơn thì số backfill
-- theo giá trị HIỆN TẠI — chỉ ảnh hưởng doanh số mốc tháng đang chạy lúc deploy (tính năng mốc
-- mới ra, chưa có claim nào trước migration này). Commission không khớp dòng nào giữ 0 (không
-- tính vào mốc — phía an toàn).
UPDATE "commissions" AS c
SET "commissionableTotal" = sub."commissionable"
FROM (
  SELECT c2."id", SUM(oi."total")::INTEGER AS "commissionable"
  FROM "commissions" c2
  JOIN "order_items" oi ON oi."orderId" = c2."orderId"
  JOIN "variations" v ON v."id" = oi."variationId"
  JOIN "products" p ON p."id" = v."productId"
  WHERE COALESCE(v."affiliateRate", 0) > 0
    AND p."affiliateBlocked" = false
  GROUP BY c2."id"
) AS sub
WHERE sub."id" = c."id";

-- 2) ctv_milestone_claims — mỗi (CTV, mốc, tháng VN) chỉ nhận 1 lần. Unique index là khoá
--    idempotency THẬT: trước đây claim chỉ findFirst-rồi-create coin_transactions trong tx READ
--    COMMITTED (không có unique cho refType 'AFFILIATE_MILESTONE') → 2 request đồng thời đều qua
--    kiểm tra và cộng 2 lần. Giờ request thua ăn P2002 → rollback cả tx cấp xu.
CREATE TABLE "ctv_milestone_claims" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "rewardXu" INTEGER NOT NULL,
    "revenue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ctv_milestone_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ctv_milestone_claims_userId_milestoneId_monthKey_key" ON "ctv_milestone_claims"("userId", "milestoneId", "monthKey");

-- AddForeignKey
ALTER TABLE "ctv_milestone_claims" ADD CONSTRAINT "ctv_milestone_claims_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
