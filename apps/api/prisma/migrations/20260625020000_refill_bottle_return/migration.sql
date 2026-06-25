-- Refill / đổi vỏ chai (§6.14.6): khách đổi vỏ chai rỗng → thưởng 💧 (nước tưới Vườn Xanh).

CREATE TABLE "bottle_returns" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "seedsAwarded" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bottle_returns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bottle_returns_userId_createdAt_idx" ON "bottle_returns"("userId", "createdAt");
ALTER TABLE "bottle_returns" ADD CONSTRAINT "bottle_returns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Config vận hành (prod KHÔNG chạy prisma db seed) — idempotent.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('refill.seeds_per_bottle', '50'::jsonb, '💧 thưởng cho mỗi vỏ chai đổi', 'refill', now()),
  ('refill.monthly_cap_bottles', '20'::jsonb, 'Trần số vỏ chai đổi được mỗi tháng/user (chống lạm dụng)', 'refill', now())
ON CONFLICT ("key") DO NOTHING;
