-- Khôi phục 3 GIN index trên products mà migration 20260628035408_phase5_subscription_fk
-- đã VÔ TÌNH DROP (artifact của `prisma migrate dev`: GIN chưa khai báo trong schema →
-- Prisma coi là drift → tự sinh DROP). Nay schema.prisma đã khai báo @@index(..., type: Gin)
-- nên drift không tái diễn; migration này đưa index trở lại DB.
--
-- + Thêm index brands_ownerUserId_idx (đồng bộ với storefronts_ownerUserId_idx) cho
--   assertOwnedBrand() tra nhãn theo chủ sở hữu.
--
-- !!! CẢNH BÁO PROD (giống 20260622010000) !!!
-- `CREATE INDEX` non-concurrent lấy SHARE lock trên `products` → chặn write tới khi build xong.
-- KHUYẾN NGHỊ: chạy CONCURRENTLY thủ công trên VM trước
-- (tools/db/create-gin-indexes-concurrently.sh) rồi `prisma migrate resolve --applied
-- 20260702040000_restore_gin_and_brand_owner_index` để deploy skip. IF NOT EXISTS → idempotent.

CREATE INDEX IF NOT EXISTS "products_categoryIds_gin" ON "products" USING GIN ("categoryIds");
CREATE INDEX IF NOT EXISTS "products_forSegment_gin"  ON "products" USING GIN ("forSegment");
CREATE INDEX IF NOT EXISTS "products_tags_gin"        ON "products" USING GIN ("tags");

CREATE INDEX IF NOT EXISTS "brands_ownerUserId_idx" ON "brands" ("ownerUserId");
