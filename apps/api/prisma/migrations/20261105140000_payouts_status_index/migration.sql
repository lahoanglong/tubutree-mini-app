-- L3-04: hộp việc admin đếm payouts theo status REQUESTED (chờ duyệt) và APPROVED (chờ chi); trước đây quét tuần tự.
-- Index thường (tên theo Prisma): Prisma truyền status là tham số nên generic plan không dùng được index một phần.
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
