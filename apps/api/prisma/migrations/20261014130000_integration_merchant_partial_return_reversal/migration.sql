-- Gộp p5 (trả theo dòng, D3) với p8 (đối soát đơn đối tác): một đơn đối tác có thể có nhiều dòng REVERSAL, mỗi lần trả một
-- phần một dòng (refKey = 'RETURN:<id yêu cầu>'); dòng của cả đơn giữ refKey ''. Mọi dòng cũ là của cả đơn nên vẫn duy nhất.

-- AlterTable
ALTER TABLE "merchant_payout_lines" ADD COLUMN "refKey" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "merchant_payout_lines_orderId_kind_key";

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payout_lines_orderId_kind_refKey_key" ON "merchant_payout_lines"("orderId", "kind", "refKey");
