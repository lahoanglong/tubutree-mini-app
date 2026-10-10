-- C-056: chấm công chỉ tự checkout sau N heartbeat ngoài vùng LIÊN TIẾP (hoặc quá M phút ngoài vùng),
-- thay vì tự chấm ra ngay nhịp đầu tiên. Additive: cột mới có DEFAULT, phiên đang mở coi như đang trong vùng.
ALTER TABLE "attendance_sessions"
  ADD COLUMN "outOfRangeCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outOfRangeSince" TIMESTAMP(3);
