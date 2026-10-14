-- ENGAGE-13: nhân viên đối chiếu số vỏ thực nhận khi duyệt đổi vỏ chai và hệ thống ghi ai duyệt/từ chối.
-- Chỉ THÊM cột nullable (không mặc định, không khoá bảng lâu); code cũ bỏ qua các cột này. Dòng cũ để NULL.
-- AlterTable
ALTER TABLE "bottle_returns" ADD COLUMN     "declaredQuantity" INTEGER,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- Điểm nhận vỏ hiện trên trang Đổi vỏ chai (rỗng = app ẩn dòng đó); admin điền ở Cấu hình hệ thống.
-- Prod không chạy seed nên tạo sẵn dòng rỗng để admin thấy khoá cần điền. DO NOTHING không đè giá trị đã có.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('refill.pickup_address', '""'::jsonb, 'Địa chỉ điểm nhận vỏ chai hiện cho khách ở trang Đổi vỏ chai (để trống = ẩn)', 'refill', now()),
  ('refill.pickup_hours', '""'::jsonb, 'Giờ mở cửa điểm nhận vỏ chai, vd "8h–20h hằng ngày" (để trống = ẩn)', 'refill', now()),
  ('refill.pickup_phone', '""'::jsonb, 'SĐT điểm nhận vỏ chai (để trống = ẩn)', 'refill', now())
ON CONFLICT ("key") DO NOTHING;

-- Thông báo duyệt/từ chối đổi vỏ trước đây ghi thẳng notification_logs không qua mẫu; nay qua mẫu để admin sửa được chữ.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-refill-approved', 'REFILL_APPROVED', 'INAPP', '🌿 Đổi vỏ chai thành công: ghi nhận {{quantity}} vỏ{{note}}, +{{seeds}} 💧 tưới cây.'),
  ('nt-refill-rejected', 'REFILL_REJECTED', 'INAPP', 'Yêu cầu đổi {{quantity}} vỏ chai chưa được duyệt{{reason}}. Bạn có thể gửi lại yêu cầu mới sau khi mang vỏ đến điểm nhận.')
ON CONFLICT DO NOTHING;
