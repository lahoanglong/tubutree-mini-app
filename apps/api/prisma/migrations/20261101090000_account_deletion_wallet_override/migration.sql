-- AlterTable
ALTER TABLE "account_deletion_requests" ADD COLUMN     "walletOverrideAmount" INTEGER,
ADD COLUMN     "walletOverrideAt" TIMESTAMP(3),
ADD COLUMN     "walletOverrideBy" TEXT,
ADD COLUMN     "walletOverrideReason" TEXT;
