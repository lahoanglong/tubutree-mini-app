-- C-057 / A2-011 (Q-13): bấm đúp "Đặt định kỳ" tạo 2 gói giống nhau, mỗi kỳ cron sinh 2 đơn COD.
-- Mỗi (khách, biến thể, địa chỉ) chỉ được có tối đa 1 gói còn chạy (ACTIVE hoặc PAUSED); gói đã huỷ
-- không tính. Nhiều gói cùng SP vẫn được nếu khác địa chỉ.
--
-- Không tự xoá/huỷ gói trùng có sẵn: không biết khách muốn giữ gói nào. Có trùng thì migration dừng,
-- xử lý tay (huỷ bớt gói thừa, báo khách) rồi chạy lại migrate deploy. Truy vấn liệt kê:
--   SELECT "userId", "variationId", "addressId", array_agg("id" ORDER BY "createdAt") AS ids
--   FROM "subscriptions" WHERE "status" IN ('ACTIVE','PAUSED')
--   GROUP BY 1, 2, 3 HAVING COUNT(*) > 1;
DO $$
DECLARE
  dup_groups integer;
BEGIN
  SELECT COUNT(*) INTO dup_groups FROM (
    SELECT 1 FROM "subscriptions"
    WHERE "status" IN ('ACTIVE', 'PAUSED')
    GROUP BY "userId", "variationId", "addressId"
    HAVING COUNT(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'subscriptions có % nhóm gói ACTIVE/PAUSED trùng (userId, variationId, addressId); xử lý tay (xem đầu migration.sql) rồi chạy lại migrate deploy', dup_groups;
  END IF;
END $$;

-- Partial unique: Prisma schema không biểu diễn được (xem A2-022), chỉ sống trong migration.
CREATE UNIQUE INDEX "subscriptions_user_variation_address_open_key"
  ON "subscriptions" ("userId", "variationId", "addressId")
  WHERE "status" IN ('ACTIVE', 'PAUSED');
