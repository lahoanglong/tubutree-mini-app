-- Idempotency guard cho loyalty.creditOrderPoints — chặn 2 webhook DELIVERED song song/retry
-- cùng insert ORDER_DELIVERED:<code> gây CỘNG ĐIỂM DOUBLE (điểm → hạng → giảm giá = money-adjacent).
-- Đối xứng với points_transactions_reverse_unique (migration 20260623000000): path reverse đã
-- hardened nhưng path credit thì chưa → bổ sung partial unique cho reason ORDER_DELIVERED.
--
-- Partial unique trên (reason, refId) where refType='ORDER' AND reason LIKE 'ORDER_DELIVERED:%'
-- → caller thua race bị P2002 → loyalty.service.ts catch bail idempotent (không cộng lần 2).
--
-- Idempotent: IF NOT EXISTS để re-run an toàn. Backfill: nếu prod đã có duplicate thì index
-- tạo sẽ FAIL — dedupe trước (giữ row sớm nhất theo createdAt).
-- LƯU Ý: dedupe chỉ xoá ROW trùng, KHÔNG hoàn lại pointsBalance đã cộng dư. Nếu DELETE bên dưới
-- xoá > 0 dòng trên prod → chạy đối soát: `pnpm --filter @tubutree/api reconcile:points` (dry-run xem
-- trước, thêm `-- --apply` để đặt lại pointsBalance = SUM(delta)). Xem scripts/reconcile-points.ts.

DO $$
BEGIN
  -- Dedupe: với mỗi (reason, refId, refType='ORDER') chỉ giữ id sớm nhất.
  DELETE FROM "points_transactions" a
  USING "points_transactions" b
  WHERE a."refType" = 'ORDER'
    AND b."refType" = 'ORDER'
    AND a."reason" = b."reason"
    AND a."refId" IS NOT NULL
    AND b."refId" IS NOT NULL
    AND a."refId" = b."refId"
    AND a."reason" LIKE 'ORDER_DELIVERED:%'
    AND a."createdAt" > b."createdAt";
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_delivered_unique"
  ON "points_transactions" ("reason", "refId")
  WHERE "refType" = 'ORDER'
    AND "refId" IS NOT NULL
    AND "reason" LIKE 'ORDER_DELIVERED:%';
