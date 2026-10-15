-- Q8 (review): phí giao hộ chốt theo lúc đặt đơn (lịch sử phí của gian hàng), liên kết takeover chỉ đối soát sau khi admin
-- xác nhận hàng ký gửi (lưu tồn lúc liên kết), và mốc bắt đầu đối soát tự động. Chỉ thêm bảng/cột; liên kết cũ để
-- consignmentConfirmedAt NULL nên liên kết takeover cũ chờ admin xác nhận, liên kết thường vẫn tính từ linkedAt.
-- AlterTable
ALTER TABLE "merchant_pancake_links" ADD COLUMN     "consignmentConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "consignmentConfirmedBy" TEXT,
ADD COLUMN     "stockAtLink" INTEGER;

-- CreateTable
CREATE TABLE "storefront_terms_history" (
    "id" TEXT NOT NULL,
    "storefrontId" TEXT NOT NULL,
    "commissionPct" DECIMAL(5,4),
    "consignmentFeePct" DECIMAL(5,4) NOT NULL,
    "consignmentFeeFixed" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,

    CONSTRAINT "storefront_terms_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storefront_terms_history_storefrontId_effectiveFrom_idx" ON "storefront_terms_history"("storefrontId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "storefront_terms_history" ADD CONSTRAINT "storefront_terms_history_storefrontId_fkey" FOREIGN KEY ("storefrontId") REFERENCES "storefronts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dòng gốc cho mọi gian hàng đối tác: mức đang có, hiệu lực từ đầu — đơn cũ luôn tìm được mức của lúc đặt.
INSERT INTO "storefront_terms_history" ("id", "storefrontId", "commissionPct", "consignmentFeePct", "consignmentFeeFixed", "effectiveFrom", "changedById")
SELECT 'sth0-' || s."id", s."id", s."commissionPct", s."consignmentFeePct", s."consignmentFeeFixed", to_timestamp(0), NULL
  FROM "storefronts" s
 WHERE s."type" = 'MERCHANT'
ON CONFLICT DO NOTHING;

-- Chỉ đơn đặt từ lúc triển khai mới tự đối soát hàng giao hộ (đơn trước đó đã thanh toán theo thoả thuận cũ).
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('merchant.consignment_settle_from', to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'Hàng "Tubu giao hộ" chỉ tự vào bảng kê đối soát với đơn đặt từ mốc này (ISO 8601)', 'merchant', now())
ON CONFLICT DO NOTHING;
