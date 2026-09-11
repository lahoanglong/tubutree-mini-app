-- BÙ DRIFT CÓ SẴN TỪ TRƯỚC — không phải thay đổi mới của đợt này.
--
-- Commit 0572e74 ("feat: update storefront builder, merchant portal, admin controls, and token
-- system") thêm một loạt field vào schema.prisma nhưng KHÔNG tạo migration nào. Hệ quả: mọi DB
-- được dựng/cập nhật bằng `prisma migrate deploy` (gồm cả prod nếu deploy theo runbook) đều
-- THIẾU các cột này, trong khi code đọc/ghi chúng — gian hàng CTV (subdomain, VietQR ngân hàng,
-- địa chỉ kho) và luồng duyệt sản phẩm đối tác không thể chạy đúng.
-- Phát hiện khi `prisma migrate dev` báo drift; xác nhận lại bằng `prisma migrate diff` giữa
-- lịch sử migration và schema.prisma (DB local thật sự thiếu đúng những cột dưới đây).
--
-- ⚠️ TRƯỚC KHI CHẠY TRÊN PROD:
-- 1) Nếu prod ĐÃ có sẵn các cột này (vd từng chạy `prisma db push` tay), mọi lệnh dưới đây đều
--    idempotent (IF NOT EXISTS / DO $$ ... EXCEPTION) nên chạy lại vẫn an toàn.
-- 2) Hai unique index subdomain/customDomain sẽ FAIL nếu prod đang có giá trị trùng. Kiểm tra
--    trước (chỉ đọc):
--      SELECT subdomain, count(*) FROM storefronts WHERE subdomain IS NOT NULL
--        GROUP BY subdomain HAVING count(*) > 1;
--      SELECT "customDomain", count(*) FROM storefronts WHERE "customDomain" IS NOT NULL
--        GROUP BY "customDomain" HAVING count(*) > 1;
--    Có dòng trả về → đổi tên thủ công 1 bên rồi mới chạy. (Postgres coi mỗi NULL là khác nhau
--    nên các gian hàng chưa đặt subdomain/customDomain không xung đột với nhau.)

-- CreateEnum (idempotent)
DO $$
BEGIN
  CREATE TYPE "ProductApprovalStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- AlterEnum: StorefrontType thêm MERCHANT (idempotent từ PG12+)
ALTER TYPE "StorefrontType" ADD VALUE IF NOT EXISTS 'MERCHANT';

-- AlterTable: products — duyệt sản phẩm do đối tác tự đăng
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "approvalStatus" "ProductApprovalStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "rejectReason" TEXT,
  ADD COLUMN IF NOT EXISTS "storefrontId" TEXT;

-- AlterTable: storefronts — subdomain/tên miền riêng, VietQR ngân hàng, địa chỉ kho
ALTER TABLE "storefronts"
  ADD COLUMN IF NOT EXISTS "subdomain" TEXT,
  ADD COLUMN IF NOT EXISTS "customDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "themeColor" TEXT DEFAULT '#16a34a',
  ADD COLUMN IF NOT EXISTS "bankName" TEXT,
  ADD COLUMN IF NOT EXISTS "bankBin" TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountNo" TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountName" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouseAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouseCity" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouseDistrict" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouseWard" TEXT,
  ADD COLUMN IF NOT EXISTS "warehousePhone" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_storefrontId_idx" ON "products"("storefrontId");
CREATE INDEX IF NOT EXISTS "products_approvalStatus_idx" ON "products"("approvalStatus");
CREATE INDEX IF NOT EXISTS "storefronts_subdomain_idx" ON "storefronts"("subdomain");

-- Unique: khoá cứng ở tầng DB cho bản vá P0-1 (storefront identifier collision, commit 15f417b).
-- Trước đó chỉ có kiểm tra ở tầng ứng dụng → 2 request đăng ký cùng subdomain chạy song song
-- vẫn có thể cùng lọt qua rồi cùng ghi.
CREATE UNIQUE INDEX IF NOT EXISTS "storefronts_subdomain_key" ON "storefronts"("subdomain");
CREATE UNIQUE INDEX IF NOT EXISTS "storefronts_customDomain_key" ON "storefronts"("customDomain");

-- AddForeignKey (idempotent)
DO $$
BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_storefrontId_fkey"
    FOREIGN KEY ("storefrontId") REFERENCES "storefronts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
