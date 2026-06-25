-- §6.6: ân hạn rớt hạng — lưu thời điểm hết ân hạn (null = không treo rớt hạng).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tierGraceUntil" TIMESTAMP(3);
