-- Beta Tester (§6.14.11): chương trình trải nghiệm sớm + kênh góp ý.

DO $$ BEGIN
  CREATE TYPE "BetaStatus" AS ENUM ('ACTIVE', 'LEFT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "beta_testers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BetaStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "beta_testers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "beta_testers_userId_key" ON "beta_testers"("userId");
ALTER TABLE "beta_testers" DROP CONSTRAINT IF EXISTS "beta_testers_userId_fkey";
ALTER TABLE "beta_testers" ADD CONSTRAINT "beta_testers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "beta_feedbacks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "beta_feedbacks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "beta_feedbacks_createdAt_idx" ON "beta_feedbacks"("createdAt");
ALTER TABLE "beta_feedbacks" DROP CONSTRAINT IF EXISTS "beta_feedbacks_userId_fkey";
ALTER TABLE "beta_feedbacks" ADD CONSTRAINT "beta_feedbacks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Config: danh sách tính năng beta (mặc định rỗng — admin thêm khi có tính năng thử nghiệm).
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('beta.features', '[]'::jsonb, 'Danh sách tính năng beta hiển thị cho người tham gia (mảng {key,title,desc})', 'beta', now())
ON CONFLICT ("key") DO NOTHING;
