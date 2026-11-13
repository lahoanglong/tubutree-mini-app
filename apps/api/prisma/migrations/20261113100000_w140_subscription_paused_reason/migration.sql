-- Gói w140: lý do gói định kỳ đang tạm dừng (khách tự dừng hay hệ thống tự dừng vì sản phẩm ngừng bán, địa chỉ hỏng, ví thiếu...).
-- Chỉ thêm cột nullable, không giá trị mặc định, không backfill: gói đã tạm dừng từ trước để NULL, giao diện đọc là "Đang tạm dừng" chung.
-- Image cũ vẫn chạy đúng: Prisma của image cũ không biết cột này và không đụng tới nó.
-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "pausedReason" TEXT;
