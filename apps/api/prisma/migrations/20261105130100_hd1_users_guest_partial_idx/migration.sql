-- AdminService.countGuestUsers: số khách vãng lai (GUEST_USER_WHERE) ở danh sách người dùng và dashboard admin. Index một phần
-- đúng điều kiện đó cho phép Index Only Scan thay vì Seq Scan cả bảng users. Chỉ SQL literal (câu đếm trong code viết literal)
-- mới dùng được; Prisma gửi dạng tham số thì planner không chứng minh được predicate. Không có trong schema.prisma.
-- Không CONCURRENTLY vì migration chạy trong transaction: khoá chặn ghi users lúc dựng.
CREATE INDEX IF NOT EXISTS "users_guest_idx"
  ON "users" ("id")
  WHERE "role" = 'CUSTOMER' AND "phone" IS NULL AND "zaloId"::text LIKE 'guest_%';
