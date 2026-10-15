-- ADMINOPS-9: admin tìm đơn theo mã vận đơn hãng (shippingCode), SĐT người nhận (shippingAddress.phone) và tên khách
-- không dấu. Additive: thêm cột + trigger + index; dữ liệu cũ được backfill, không đổi cột nào khác.
-- Dùng lại hàm vn_search_fold (migration 20261010053812_catalog_name_search_index) và pg_trgm
-- (migration 20261010042435_admin_cron_query_indexes).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "fullNameSearch" TEXT NOT NULL DEFAULT '';

UPDATE "users" SET "fullNameSearch" = vn_search_fold(COALESCE("fullName", '')) WHERE "fullName" IS NOT NULL;

-- Ghi đè cả khi ai đó tự UPDATE "fullNameSearch": cột luôn là hàm của fullName.
CREATE OR REPLACE FUNCTION users_full_name_search_sync() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $fn$
BEGIN
  NEW."fullNameSearch" := vn_search_fold(COALESCE(NEW."fullName", ''));
  RETURN NEW;
END
$fn$;

CREATE TRIGGER users_full_name_search_sync
BEFORE INSERT OR UPDATE OF "fullName", "fullNameSearch" ON "users"
FOR EACH ROW EXECUTE FUNCTION users_full_name_search_sync();

-- CreateIndex
CREATE INDEX "orders_shippingCode_trgm_idx" ON "orders" USING GIN ("shippingCode" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_fullNameSearch_trgm_idx" ON "users" USING GIN ("fullNameSearch" gin_trgm_ops);

-- SĐT người nhận trong ảnh chụp địa chỉ (đơn CTV lên hộ, đơn tặng): so khớp đúng số, nên btree trên biểu thức là đủ.
-- Prisma không khai báo được index biểu thức; AdminService tra bằng đúng biểu thức này (findSearchOrderIds).
CREATE INDEX "orders_shippingAddress_phone_idx" ON "orders" (("shippingAddress" ->> 'phone'));
