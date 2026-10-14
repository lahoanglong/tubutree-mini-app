-- Q8 (S7): phần Điểm Xanh (đồng) trừ vào từng dòng lúc đặt — chỉ dòng hàng Tubu nhận điểm. Chỉ thêm cột nullable; đơn cũ để
-- NULL và trả hàng chia điểm theo giá trị dòng như trước.
-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "pointsDiscount" INTEGER;
