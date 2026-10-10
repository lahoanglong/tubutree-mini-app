-- C-045: dedupe webhook Pancake + claim worker + index cho cron cứu sự kiện kẹt.
-- Additive: 2 cột nullable, không backfill. Dòng cũ dedupeKey NULL (Postgres cho nhiều NULL trong
-- unique) nên index unique không thể vỡ trên dữ liệu PROD có sẵn, kể cả khi đã có sự kiện trùng.
-- CREATE INDEX thường (Prisma chạy migration trong transaction) khoá ghi bảng tới khi dựng xong —
-- webhook Pancake trong lúc đó chờ; đo trên bản sao: xem docs/2026-10-review/impl/PB-1.md.

-- AlterTable
ALTER TABLE "pancake_webhook_events" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pancake_webhook_events_dedupeKey_key" ON "pancake_webhook_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "pancake_webhook_events_status_receivedAt_idx" ON "pancake_webhook_events"("status", "receivedAt");
