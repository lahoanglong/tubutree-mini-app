-- Chặn 2 request đăng ký đại lý đồng thời (apply()) tạo 2 DealerApplication PENDING trùng cho
-- cùng 1 user: findFirst rồi create không transaction, DealerApplication không có unique nào
-- trên (userId, status) → race window giữa findFirst và create. apply() bắt P2002 → trả message
-- thân thiện giống nhánh "đã có đơn đang chờ duyệt" hiện có.
-- Partial (chỉ status='PENDING'): user vẫn được nộp lại đơn mới sau khi đơn cũ đã APPROVED/
-- REJECTED/SUSPENDED — không khoá lịch sử nhiều đơn/user, chỉ chặn nhiều đơn CHỜ DUYỆT cùng lúc.
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_applications_pending_user_key"
  ON "dealer_applications"("userId") WHERE "status" = 'PENDING';
