-- Gộp p5 (trả theo dòng, D3) với p8 (đối soát đơn đối tác): một đơn đối tác có thể có nhiều dòng REVERSAL, mỗi lần trả một
-- phần một dòng (refKey = 'RETURN:<id yêu cầu>'); dòng của cả đơn giữ refKey ''. Mọi dòng cũ là của cả đơn nên vẫn duy nhất.

-- AlterTable
ALTER TABLE "merchant_payout_lines" ADD COLUMN "refKey" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "merchant_payout_lines_orderId_kind_key";

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payout_lines_orderId_kind_refKey_key" ON "merchant_payout_lines"("orderId", "kind", "refKey");

-- Báo chủ gian hàng tự giao khi yêu cầu trả hàng của đơn được duyệt: hàng về gian hàng, gian hàng xác nhận đã nhận.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-merchant-return-approved', 'MERCHANT_RETURN_APPROVED', 'INAPP', 'Khách trả hàng đơn {{order_code}} ({{items}}) đã được duyệt. Khi nhận được hàng, hãy bấm "Đã nhận hàng trả" trong Cổng người bán để cộng lại tồn kho.')
ON CONFLICT DO NOTHING;
