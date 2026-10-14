-- Q8 (review M1): tiền khách thực trả từng dòng lúc đặt — mỗi khoản giảm chỉ vào dòng được hưởng. Chỉ thêm cột nullable;
-- đơn cũ để NULL và mọi nơi đọc chia tiền hàng thực trả theo giá trị dòng như trước.
-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "paidTotal" INTEGER;
