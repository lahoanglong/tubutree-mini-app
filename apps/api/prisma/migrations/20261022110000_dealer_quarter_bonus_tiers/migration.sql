-- CreateTable
CREATE TABLE "dealer_quarter_bonus_tiers" (
    "quarter" TEXT NOT NULL,
    "tiers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealer_quarter_bonus_tiers_pkey" PRIMARY KEY ("quarter")
);
