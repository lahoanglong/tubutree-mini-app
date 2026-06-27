-- Idempotency cho thưởng TubuXu nhiệm vụ gian hàng: mỗi (user, quest-reason) chỉ thưởng 1 lần.
-- reason dạng "STOREFRONT_QUEST:<code>" KHÔNG nhúng userId nên unique phải gồm (userId, reason).
-- Mirror "coin_transactions_referral_unique"; grantCoins bắt P2002 → bail idempotent.
CREATE UNIQUE INDEX "coin_transactions_quest_unique"
  ON "coin_transactions" ("userId", "reason")
  WHERE "refType" = 'QUEST';
