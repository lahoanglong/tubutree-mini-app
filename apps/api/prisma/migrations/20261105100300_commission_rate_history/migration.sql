-- Bảng mới, chỉ thêm: không đụng dữ liệu cũ. variationId không đặt khoá ngoại để lịch sử vẫn còn khi biến thể bị xoá.
CREATE TABLE "commission_rate_history" (
    "id" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "fromPct" DECIMAL(65,30),
    "toPct" DECIMAL(65,30),
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rate_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commission_rate_history_variationId_createdAt_idx" ON "commission_rate_history"("variationId", "createdAt");

CREATE INDEX "commission_rate_history_actorId_createdAt_idx" ON "commission_rate_history"("actorId", "createdAt");
