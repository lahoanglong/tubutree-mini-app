-- NS-1 (% khách có đơn thứ 2 trong 30 ngày) vào retention_daily_snapshot (C-032). Hai cột nullable, không backfill
-- trong migration: dòng cũ để NULL (= chưa tính), script apps/api/scripts/backfill-ns1.ts tính lại các ngày đã qua.
ALTER TABLE "retention_daily_snapshot"
  ADD COLUMN "ns1CohortSize" INTEGER,
  ADD COLUMN "ns1RepeatCount" INTEGER;
