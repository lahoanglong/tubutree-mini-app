-- GroupBuy.couponsGrantedAt: đánh dấu nhóm SUCCESS đã phát đủ coupon cho mọi thành viên chưa.
-- null = chưa/còn sót (lỗi DB tạm thời) → cron reconcileSuccessfulGroups quét cấp lại (idempotent).
-- Idempotent (IF NOT EXISTS) để an toàn nếu chạy lại.
ALTER TABLE "group_buys" ADD COLUMN IF NOT EXISTS "couponsGrantedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "group_buys_status_couponsGrantedAt_idx"
  ON "group_buys" ("status", "couponsGrantedAt");
