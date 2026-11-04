-- Mốc khoản Pancake chưa gắn ĐẦU TIÊN của đơn (paymentUnlinkedAt bị đẩy lên mỗi cặp mới nên không dùng được cho "cũ nhất" và hạn tự huỷ).
-- Chỉ thêm cột nullable, không viết lại dòng, không dựng chỉ mục.
ALTER TABLE "orders" ADD COLUMN "paymentUnlinkedFirstAt" TIMESTAMP(3);
