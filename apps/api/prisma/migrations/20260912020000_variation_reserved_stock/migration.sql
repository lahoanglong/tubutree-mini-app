-- Tồn kho: tách "số Pancake báo" khỏi "số ta bán được", để lượt đồng bộ 15 phút không còn
-- ghi đè tuyệt đối và hồi sinh hàng vừa bán hết (P0-3).
--
--   stock         = tồn kho bán được (mọi nơi kiểm tồn vẫn đọc cột này — không đổi)
--   pancakeStock  = remain_quantity Pancake báo lần gần nhất; NULL = chưa từng đồng bộ
--   reservedStock = số đã bán bằng đơn của ta mà số Pancake chưa phản ánh
--
-- Sync: stock = pancakeStock_mới − reservedStock, và mỗi lần số Pancake GIẢM thì nhả bấy nhiêu
-- khỏi reservedStock. Đúng cho cả hai khả năng (Pancake tự trừ tồn khi ta tạo đơn hoặc không).

ALTER TABLE "variations" ADD COLUMN "pancakeStock" INTEGER;
ALTER TABLE "variations" ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0;

-- KHÔNG gán pancakeStock = stock cho dữ liệu cũ. Để NULL: lượt sync kế tiếp chỉ GHI MỐC
-- (pancakeStock = số Pancake) mà không đụng `stock`, nên không có cú đặt lại tồn kho một lần
-- ngay sau khi deploy. Từ lượt sau trở đi công thức chênh lệch mới có hiệu lực.
