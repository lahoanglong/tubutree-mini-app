-- VouchersService.milestoneReceived: voucher mốc đã cấp trong một kỳ (cron hằng ngày quét 4 kỳ). Câu cũ lọc
-- `code LIKE 'MILESTONE%'` + `scopeMeta #>> reason LIKE '%-yyyy-mm'`; hậu tố có `%` đứng đầu nên không index nào phục vụ được,
-- và tiền tố trên `code` chỉ dùng được index khi DB có collation C. Index một phần theo hậu tố 8 ký tự của reason (-yyyy-mm).
-- Không có trong schema.prisma (Prisma không biểu diễn được partial/expression index).
-- Không CONCURRENTLY vì migration chạy trong transaction; chỉ chiếm số dòng MILESTONE trong bảng coupons (khoá ghi coupons trong lúc dựng).
CREATE INDEX IF NOT EXISTS "coupons_milestone_period_idx"
  ON "coupons" ((right("scopeMeta" ->> 'reason', 8)), "id")
  WHERE "code" LIKE 'MILESTONE%';
