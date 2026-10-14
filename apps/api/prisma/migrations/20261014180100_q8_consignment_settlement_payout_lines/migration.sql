-- Q8: hàng "Tubu giao hộ" đối soát qua cùng phiếu với hàng gian hàng tự giao, mỗi dòng hàng một dòng phiếu (refKey ITEM:<id>).
-- Chỉ thêm cột có mặc định / cho phép NULL: dòng phiếu cũ là đơn tự giao (orderItemId NULL, opsFeeAmount 0), gian hàng cũ
-- không có phí giao hộ (0). Không cần chép dữ liệu: bảng kê tính từ đơn lúc xem nên đơn giao hộ đã giao trong thời gian
-- liên kết mà chưa có dòng tự vào bảng kê kỳ tới.
-- AlterTable
ALTER TABLE "merchant_payout_lines" ADD COLUMN     "opsFeeAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orderItemId" TEXT;

-- AlterTable
ALTER TABLE "storefronts" ADD COLUMN     "consignmentFeeFixed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "consignmentFeePct" DECIMAL(5,4) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "merchant_payout_lines_orderItemId_idx" ON "merchant_payout_lines"("orderItemId");

-- AddForeignKey
ALTER TABLE "merchant_payout_lines" ADD CONSTRAINT "merchant_payout_lines_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
