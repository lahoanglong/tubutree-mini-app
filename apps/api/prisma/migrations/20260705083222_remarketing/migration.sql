-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "abandonRemindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "remindedAt" TIMESTAMP(3);
