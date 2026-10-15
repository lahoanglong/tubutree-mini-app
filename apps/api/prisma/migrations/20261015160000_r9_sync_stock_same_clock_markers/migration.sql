-- Mốc tồn kho cùng đồng hồ máy chủ cho lượt đồng bộ danh mục và webhook tồn kho (R5-SYNC-3): lúc đồng bộ bắt đầu đọc trang
-- Pancake, và lúc nhận webhook tồn kho muộn nhất đã áp. Cột NULL được, không default nên không viết lại bảng: ADD COLUMN chỉ
-- giữ ACCESS EXCLUSIVE trên "variations" trong chốc lát (đổi catalog của bảng). Dòng cũ để NULL = chưa có mốc, áp như trước.
-- AlterTable
ALTER TABLE "variations" ADD COLUMN     "pancakeStockSyncReadAt" TIMESTAMP(3),
ADD COLUMN     "pancakeStockWebhookReceivedAt" TIMESTAMP(3);
