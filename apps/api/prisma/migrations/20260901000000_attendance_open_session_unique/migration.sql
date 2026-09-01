-- Chặn 2 phiên chấm công MỞ đồng thời cho cùng 1 nhân viên (race: 2 request checkin() song
-- song cùng đọc "chưa có phiên mở" trước khi phiên đầu commit → tạo 2 AttendanceSession →
-- payroll.calc cộng dồn cả 2 → khai khống giờ công). checkin() bắt P2002 → trả lại đúng lỗi
-- nghiệp vụ cũ ("Bạn đang trong ca, hãy checkout trước.").
CREATE UNIQUE INDEX "attendance_sessions_open_staff_key"
  ON "attendance_sessions"("staffId") WHERE "checkoutAt" IS NULL;
