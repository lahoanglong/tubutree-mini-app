-- Idempotency cho đổi Ví → TubuXu (P2, docs/2026-09-08-review-progress.md).
-- Đây là endpoint tiền DUY NHẤT trước giờ không có Idempotency-Key, trong khi chiều đổi là
-- MỘT CHIỀU (xu không rút được, không có đường về ví) → double-tap "Đổi ngay" là mất vĩnh viễn
-- phần tiền rút được đã đổi dư. Khoá lưu ở coin_transactions.refId với refType='CONVERT'.
--
-- Partial: chỉ ràng buộc đúng nhóm CONVERT — refId của REFERRAL/ORDER/GAME vẫn trùng nhau
-- thoải mái (nhiều giao dịch cùng trỏ 1 đơn/1 lần giới thiệu là bình thường).
CREATE UNIQUE INDEX IF NOT EXISTS "coin_transactions_convert_ref_key"
  ON "coin_transactions"("refId") WHERE "refType" = 'CONVERT' AND "refId" IS NOT NULL;
