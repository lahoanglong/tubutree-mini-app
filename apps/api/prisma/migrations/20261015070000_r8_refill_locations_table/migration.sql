-- R8: nhiều điểm nhận vỏ chai. Chỉ THÊM: một bảng mới và một cột nullable ở bottle_returns (không mặc định, không viết lại bảng;
-- ADD COLUMN chỉ giữ khoá ngắn, ADD FOREIGN KEY quét bảng bottle_returns nhỏ toàn NULL). Dòng cũ để pickupLocationId NULL, code cũ bỏ qua cột này.
-- AlterTable
ALTER TABLE "bottle_returns" ADD COLUMN     "pickupLocationId" TEXT;

-- CreateTable
CREATE TABLE "refill_pickup_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "hours" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refill_pickup_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refill_pickup_locations_isActive_sortOrder_idx" ON "refill_pickup_locations"("isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "bottle_returns" ADD CONSTRAINT "bottle_returns_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "refill_pickup_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Chuyển điểm nhận đang cấu hình ở SystemConfig refill.pickup_* thành điểm đầu tiên, để triển khai xong khách không thấy màn trống.
-- Chỉ chạy khi có địa chỉ và bảng còn trống; id cố định + ON CONFLICT nên chạy lại không sinh bản sao. Ba khoá cũ giữ nguyên (đọc dự phòng một đợt, và bản cũ quay lại vẫn chạy).
INSERT INTO "refill_pickup_locations" ("id", "name", "address", "hours", "phone", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
  'rpl-seed-default',
  'Điểm nhận vỏ chính',
  btrim(a."v", E' \t\r\n'),
  nullif(btrim(coalesce((SELECT "value" #>> '{}' FROM "system_configs" WHERE "key" = 'refill.pickup_hours' AND jsonb_typeof("value") = 'string'), ''), E' \t\r\n'), ''),
  nullif(btrim(coalesce((SELECT "value" #>> '{}' FROM "system_configs" WHERE "key" = 'refill.pickup_phone' AND jsonb_typeof("value") = 'string'), ''), E' \t\r\n'), ''),
  true,
  0,
  now(),
  now()
FROM (
  SELECT "value" #>> '{}' AS "v" FROM "system_configs" WHERE "key" = 'refill.pickup_address' AND jsonb_typeof("value") = 'string'
) a
WHERE btrim(a."v", E' \t\r\n') <> ''
  AND NOT EXISTS (SELECT 1 FROM "refill_pickup_locations")
ON CONFLICT ("id") DO NOTHING;

-- Ba khoá cũ chỉ còn là dự phòng khi bảng chưa có dòng nào: nói rõ ở mô tả để admin không sửa nhầm chỗ rồi tưởng không có tác dụng.
UPDATE "system_configs" SET "description" = CASE "key"
  WHEN 'refill.pickup_address' THEN 'CŨ (dự phòng): địa chỉ điểm nhận vỏ. Quản lý điểm nhận ở Quản trị → Đổi vỏ chai → Điểm nhận vỏ; khoá này chỉ được đọc khi bảng đó chưa có điểm nào.'
  WHEN 'refill.pickup_hours' THEN 'CŨ (dự phòng): giờ mở cửa điểm nhận vỏ. Quản lý ở Quản trị → Đổi vỏ chai → Điểm nhận vỏ.'
  WHEN 'refill.pickup_phone' THEN 'CŨ (dự phòng): SĐT điểm nhận vỏ. Quản lý ở Quản trị → Đổi vỏ chai → Điểm nhận vỏ.'
END
WHERE "key" IN ('refill.pickup_address', 'refill.pickup_hours', 'refill.pickup_phone');
