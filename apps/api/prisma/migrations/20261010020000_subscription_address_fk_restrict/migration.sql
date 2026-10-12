-- C-014 / A2-003 (Q-12): xoá địa chỉ từng xoá cứng luôn gói giao định kỳ (ON DELETE CASCADE). Đổi sang
-- RESTRICT: chỉ đổi hành vi khi xoá, không đụng dòng dữ liệu nào. FK cũ đã bảo đảm không có gói mồ côi;
-- vẫn kiểm lại cho chắc vì ADD CONSTRAINT sẽ lỗi khó hiểu nếu có. Truy vấn liệt kê:
--   SELECT s."id", s."addressId" FROM "subscriptions" s
--   LEFT JOIN "addresses" a ON a."id" = s."addressId" WHERE a."id" IS NULL;
DO $$
DECLARE
  orphans integer;
BEGIN
  SELECT COUNT(*) INTO orphans
  FROM "subscriptions" s LEFT JOIN "addresses" a ON a."id" = s."addressId"
  WHERE a."id" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'subscriptions có % gói trỏ tới địa chỉ không tồn tại; xử lý tay (xem đầu migration.sql) rồi chạy lại migrate deploy', orphans;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_addressId_fkey";

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
