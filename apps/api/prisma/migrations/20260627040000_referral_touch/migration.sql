-- CreateTable
CREATE TABLE "referral_touches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "storefrontSlug" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'ctv',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "referral_touches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_touches_userId_key" ON "referral_touches"("userId");

-- CreateIndex
CREATE INDEX "referral_touches_expiresAt_idx" ON "referral_touches"("expiresAt");
