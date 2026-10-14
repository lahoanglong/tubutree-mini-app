-- AlterTable
ALTER TABLE "merchant_payouts" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelSnapshot" JSONB,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT;

-- Phiếu đã huỷ trước đây bị ghi đè ghi chú bằng "Huỷ bởi <id admin>" (lộ id nội bộ cho gian hàng): chuyển id sang cột riêng và
-- bỏ ghi chú đã mất nội dung gốc. Chỉ chạm đúng dòng còn nguyên dạng cũ; phiếu mới dùng cancelledBy/cancelReason.
UPDATE "merchant_payouts"
   SET "cancelledBy" = substring("note" FROM 'Huỷ bởi (.*)$'),
       "note" = NULL
 WHERE "status" = 'CANCELLED' AND "note" LIKE 'Huỷ bởi %' AND "cancelledBy" IS NULL;
