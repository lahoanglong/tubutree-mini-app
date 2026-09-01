-- Chặn 2 request đổi/trả cùng lúc tạo 2 dòng REQUESTED cho cùng 1 đơn (2 tab, double-tap):
-- pre-check đọc-rồi-tạo không atomic. requestReturn() bắt P2002 → trả đúng lỗi nghiệp vụ cũ.
CREATE UNIQUE INDEX "return_requests_open_order_key"
  ON "return_requests"("orderId") WHERE "status" = 'REQUESTED';
