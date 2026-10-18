-- Lịch sử sửa bậc đại lý (D1-06): chiết khấu, hạn mức công nợ, điều kiện là tham số tiền nên mọi lần đổi phải truy được.
CREATE TABLE "dealer_tier_history" (
    "id" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealer_tier_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dealer_tier_history_tierId_changedAt_idx" ON "dealer_tier_history"("tierId", "changedAt");
CREATE INDEX "dealer_tier_history_changedAt_idx" ON "dealer_tier_history"("changedAt");
