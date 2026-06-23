-- Perf: GIN index cho 3 cột mảng được lọc bằng 'has' trong catalog.service.ts list().
--
-- !!! CẢNH BÁO PROD !!!
-- `CREATE INDEX` (non-concurrent) lấy SHARE lock trên `products` → CHẶN mọi
-- UPDATE/INSERT/DELETE (giảm stock đơn hàng, sync Pancake) cho tới khi build xong.
-- Dockerfile chạy `prisma migrate deploy` ngay khi container API start → API
-- không serve được trong window đó.
--
-- KHUYẾN NGHỊ TRƯỚC KHI DEPLOY:
--   1. Chạy CONCURRENTLY thủ công trên VM (xem tools/db/create-gin-indexes-concurrently.sh):
--        psql ... -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_categoryIds_gin" ...'
--      (CONCURRENTLY KHÔNG chạy được trong transaction → Prisma migrate KHÔNG dùng được.)
--   2. Mark migration đã applied: `prisma migrate resolve --applied 20260622010000_catalog_gin_indexes`
--   3. Deploy bình thường → Prisma sẽ skip migration này.
--
-- IF NOT EXISTS để idempotent — nếu (1) đã làm thì lệnh dưới no-op an toàn.
CREATE INDEX IF NOT EXISTS "products_categoryIds_gin" ON "products" USING GIN ("categoryIds");
CREATE INDEX IF NOT EXISTS "products_forSegment_gin" ON "products" USING GIN ("forSegment");
CREATE INDEX IF NOT EXISTS "products_tags_gin"        ON "products" USING GIN ("tags");
