-- L3-04: hộp việc admin đếm payouts theo status REQUESTED (chờ duyệt) và APPROVED (chờ chi); trước đây quét tuần tự.
-- Một phần: chỉ các lệnh còn trong hàng đợi (số nhỏ), các lệnh PAID/REJECTED đã xong không làm index phình.
CREATE INDEX IF NOT EXISTS "payouts_pending_status_idx"
  ON "payouts" ("status") WHERE "status" IN ('REQUESTED', 'APPROVED');
