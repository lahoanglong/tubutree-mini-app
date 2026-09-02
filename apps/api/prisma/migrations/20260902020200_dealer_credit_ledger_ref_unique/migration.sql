-- Chặn double-pay ở DealerService.payoutQuarterlyBonuses(): findFirst rồi create ngoài
-- transaction, 2 lần chạy cron/manual chồng nhau (vd cron trễ + admin bấm chạy tay) có thể trả
-- thưởng trùng 1 quý cho cùng dealer. payoutQuarterlyBonuses() bắt P2002 khi create → coi như đã
-- trả thưởng (giữ nguyên vòng lặp for, không throw để không chặn các dealer khác trong cùng lượt chạy).
--
-- ĐÃ RÀ SOÁT toàn bộ nơi tạo DealerCreditLedger trong dealer.service.ts (chỉ 3 chỗ, không có nơi
-- nào khác trong repo) trước khi thêm constraint này — an toàn với dữ liệu hiện có:
--  - refType='ORDER': refId=order.id (globally unique) → (userId,refType,refId) tự nhiên đã không
--    trùng, constraint không phá dữ liệu cũ.
--  - refType='PAYMENT' (creditPayment): KHÔNG truyền refId → luôn NULL. Postgres coi mỗi NULL là
--    giá trị riêng biệt trong UNIQUE index (không tự đụng nhau) → nhiều lần thanh toán công nợ của
--    cùng 1 dealer vẫn tạo được nhiều dòng PAYMENT bình thường, KHÔNG bị chặn nhầm bởi index này.
--  - refType='QUARTER_BONUS': refId=quarter (vd "Q3/2026") — ĐÚNG cặp cần chặn trùng.
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_credit_ledgers_userId_refType_refId_key"
  ON "dealer_credit_ledgers"("userId", "refType", "refId");
