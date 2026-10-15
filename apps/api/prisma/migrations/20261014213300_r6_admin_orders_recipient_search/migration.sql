-- R4-ADMIN-4: admin tìm đơn theo tên người nhận (đơn tặng người thân: tài khoản đặt một tên, vận đơn ghi tên khác), có hoặc
-- không dấu. Additive: thêm cột + trigger + index; dữ liệu cũ được backfill, không đổi cột nào khác. Cùng mẫu với
-- users."fullNameSearch" (migration 20261014150000_p4_admin_ops_search): dùng lại hàm vn_search_fold (migration
-- 20261010053812_catalog_name_search_index) và pg_trgm (migration 20261010042435_admin_cron_query_indexes).

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "recipientSearch" TEXT NOT NULL DEFAULT '';

UPDATE "orders" SET "recipientSearch" = vn_search_fold("shippingAddress" ->> 'recipient')
 WHERE COALESCE("shippingAddress" ->> 'recipient', '') <> '';

-- Ghi đè cả khi ai đó tự UPDATE "recipientSearch": cột luôn là hàm của shippingAddress.recipient.
CREATE OR REPLACE FUNCTION orders_recipient_search_sync() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $fn$
BEGIN
  NEW."recipientSearch" := vn_search_fold(COALESCE(NEW."shippingAddress" ->> 'recipient', ''));
  RETURN NEW;
END
$fn$;

CREATE TRIGGER orders_recipient_search_sync
BEFORE INSERT OR UPDATE OF "shippingAddress", "recipientSearch" ON "orders"
FOR EACH ROW EXECUTE FUNCTION orders_recipient_search_sync();

-- CreateIndex
CREATE INDEX "orders_recipientSearch_trgm_idx" ON "orders" USING GIN ("recipientSearch" gin_trgm_ops);
