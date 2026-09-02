-- Thêm cột createdAt cho Lesson: orderBy lesson trước đây chỉ sort theo sortOrder, không có
-- tiebreaker → nhiều lesson cùng sortOrder=0 (mặc định addLesson không truyền sortOrder) có thứ
-- tự không ổn định giữa các lần load (phụ thuộc thứ tự vật lý trên đĩa/kế hoạch truy vấn).
-- DEFAULT CURRENT_TIMESTAMP backfill lesson cũ NOT NULL ngay khi ALTER (mọi dòng cũ nhận cùng 1
-- giá trị tại thời điểm migrate — chỉ đổi thứ tự tiebreaker của các lesson cùng sortOrder=0 TỪ
-- migration này trở đi, không có dữ liệu nào bị mất).
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
