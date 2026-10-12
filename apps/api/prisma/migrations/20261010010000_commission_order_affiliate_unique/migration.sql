-- C-002 / A2-005: mỗi (đơn, người hưởng) chỉ có MỘT dòng hoa hồng. Không tự xoá dòng trùng: dòng
-- trùng có thể đã APPROVED/PAID (đã chi tiền), chọn giữ dòng nào là quyết định đối soát của người.
-- Có trùng thì dừng migration; sau khi xử lý: prisma migrate resolve --rolled-back <tên thư mục này>
-- rồi migrate deploy lại. Truy vấn liệt kê:
--   SELECT "orderId", "affiliateUserId", array_agg("id" || ':' || "status" ORDER BY "createdAt")
--   FROM "commissions" GROUP BY 1, 2 HAVING COUNT(*) > 1;
DO $$
DECLARE
  dup_groups integer;
BEGIN
  SELECT COUNT(*) INTO dup_groups FROM (
    SELECT 1 FROM "commissions" GROUP BY "orderId", "affiliateUserId" HAVING COUNT(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'commissions có % cặp (orderId, affiliateUserId) trùng; đối soát và xoá dòng thừa (xem đầu migration.sql) rồi chạy lại migrate deploy', dup_groups;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "commissions_orderId_affiliateUserId_key" ON "commissions"("orderId", "affiliateUserId");
