-- C-038: tìm không dấu đọc cột "nameSearch" (tên đã gấp dấu) có index trigram, thay cho
-- regexp_replace(lower(translate(name, …))) tính lại trên MỌI dòng mỗi lần tìm (quét tuần tự).
-- Additive: thêm cột + hàm + trigger + index; dữ liệu cũ được backfill, không đổi cột nào khác.
-- Cần extension pg_trgm (tạo ở migration 20261010042435_admin_cron_query_indexes).
-- CREATE INDEX thường (Prisma chạy migration trong transaction) khoá ghi bảng products tới khi dựng
-- xong — bảng nhỏ (vài nghìn SP), đo trên bản sao: xem docs/2026-10-review/impl/PB-1.md.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "nameSearch" TEXT NOT NULL DEFAULT '';

-- PHẢI trùng từng ký tự với foldVietnamese (apps/api/src/modules/catalog/search-text.ts):
-- VN_FOLD_FROM/VN_FOLD_TO (8 dấu kết hợp NFD ở cuối "from" bị xoá vì "to" ngắn hơn) và
-- SQL_WHITESPACE_RE. Pin bằng test/integration-race/catalog-search-index.race-spec.ts. Chuỗi E'' để
-- các escape Unicode không phụ thuộc standard_conforming_strings. Không SET search_path để Postgres còn
-- inline được hàm SQL (chỉ gọi hàm của pg_catalog).
CREATE OR REPLACE FUNCTION vn_search_fold(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT btrim(regexp_replace(
    lower(translate(
      t,
      'àáạảãâầấậẩẫăằắặẳẵÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴèéẹẻẽêềếệểễÈÉẸẺẼÊỀẾỆỂỄìíịỉĩÌÍỊỈĨòóọỏõôồốộổỗơờớợởỡÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠùúụủũưừứựửữÙÚỤỦŨƯỪỨỰỬỮỳýỵỷỹỲÝỴỶỸđĐ' || E'\u031b\u0323\u0300\u0301\u0303\u0309\u0302\u0306',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeeeeeeeiiiiiiiiiioooooooooooooooooooooooooooooooooouuuuuuuuuuuuuuuuuuuuuuyyyyyyyyyydd'
    )),
    E'[[:space:]\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+',
    ' ',
    'g'
  ))
$fn$;

UPDATE "products" SET "nameSearch" = vn_search_fold("name");

-- Ghi đè cả khi ai đó tự UPDATE "nameSearch": cột luôn là hàm của name.
CREATE OR REPLACE FUNCTION products_name_search_sync() RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $fn$
BEGIN
  NEW."nameSearch" := vn_search_fold(NEW."name");
  RETURN NEW;
END
$fn$;

CREATE TRIGGER products_name_search_sync
BEFORE INSERT OR UPDATE OF "name", "nameSearch" ON "products"
FOR EACH ROW EXECUTE FUNCTION products_name_search_sync();

-- CreateIndex
CREATE INDEX "products_nameSearch_trgm_idx" ON "products" USING GIN ("nameSearch" gin_trgm_ops);
