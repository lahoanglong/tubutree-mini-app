-- Hàng đợi xử lý Payout cho admin (P0 A5-08 = A6-05, audit 2026-09-27): Payout method=BANK được
-- tạo REQUESTED (wallet.service.ts:withdraw hoặc affiliate.service.ts:requestPayout nhánh BANK)
-- nhưng trước đây KHÔNG có endpoint/màn admin nào để xem/duyệt/từ chối/đánh dấu đã trả — tiền bị
-- trừ khỏi số dư CTV (hoặc commission bị khoá) rồi "biến mất" khỏi mọi hàng đợi xử lý được.
--
-- Thêm cột ghi vết ai duyệt/từ chối/đã trả, mirror đúng pattern dealer_reward_claims
-- (reviewedBy/reviewedAt/rejectionReason/paidBy/adminNote) + bankRef riêng cho payout (mã giao
-- dịch ngân hàng lúc mark-paid).
--
-- An toàn với dữ liệu hiện có: chỉ THÊM cột (đều NULLABLE), không sửa/xoá cột nào; payouts.paidAt
-- đã có sẵn từ trước, tái dùng cho mark-paid — không thêm cột trùng.
ALTER TABLE "payouts"
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "paidBy" TEXT,
  ADD COLUMN "bankRef" TEXT,
  ADD COLUMN "adminNote" TEXT;
