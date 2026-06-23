-- Idempotency guard cho loyalty.reverseOrderPoints — chặn 2 caller song song
-- (orders.cancel + webhook RETURNED) cùng insert ORDER_REVERSED/ORDER_REFUND_POINTS
-- gây trừ/hoàn điểm DOUBLE. Partial unique trên (reason, refId) where refType='ORDER'
-- → caller thua sẽ bị P2002 và bail idempotent (xem loyalty.service.ts catch).
--
-- Idempotent: IF NOT EXISTS để re-run an toàn. Backfill: nếu prod đã có duplicate
-- thì index tạo sẽ FAIL — dedupe trước (giữ row sớm nhất theo createdAt).

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
    AND (a."reason" LIKE 'ORDER_REVERSED:%' OR a."reason" LIKE 'ORDER_REFUND_POINTS:%')
    AND a."createdAt" > b."createdAt";
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_reverse_unique"
  ON "points_transactions" ("reason", "refId")
  WHERE "refType" = 'ORDER'
    AND "refId" IS NOT NULL
    AND ("reason" LIKE 'ORDER_REVERSED:%' OR "reason" LIKE 'ORDER_REFUND_POINTS:%');
