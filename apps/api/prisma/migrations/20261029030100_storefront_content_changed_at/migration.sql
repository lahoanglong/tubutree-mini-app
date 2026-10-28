-- Gian hàng đã duyệt mà chủ đổi tên, lời giới thiệu hoặc ảnh: đánh dấu để admin lọc và bấm "Đã xem". Chỉ thêm một cột, không bắt duyệt lại.

-- AlterTable
ALTER TABLE "storefronts" ADD COLUMN     "contentChangedAt" TIMESTAMP(3);
