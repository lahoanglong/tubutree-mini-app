-- Gói w45-02: phễu đơn sàn (external-claims-funnel.ts, bước `members`) và báo cáo nguồn khách nối "users"."mergedIntoId" về tài
-- khoản đích. Cột chưa có index nên mỗi lần tính phễu quét cả bảng users.
-- Không CONCURRENTLY vì migration chạy trong transaction: khoá chặn ghi users trong lúc dựng (cột thưa, phần lớn NULL, dựng nhanh).
-- Image cũ vẫn chạy đúng: không đổi cột, chỉ thêm index.
CREATE INDEX IF NOT EXISTS "users_mergedIntoId_idx" ON "users" ("mergedIntoId");
