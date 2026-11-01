-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "listed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "coupons_listed_endAt_idx" ON "coupons"("listed", "endAt");

-- Hàng rào cuối nếu mã bị ghi thẳng DB: kho mã công khai chỉ chứa mã CLAIM chung. Mã thuộc lô thẻ in mà liệt kê công khai thì ai cũng nhận được.
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_listed_claim_only_chk" CHECK (NOT "listed" OR ("scope" = 'CLAIM' AND "batch" IS NULL));
