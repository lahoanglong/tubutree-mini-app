-- Khoá giới hạn Giờ vàng phụ (SĐT, IP đã băm) mà lần đặt của người mua chưa xác thực đã trừ (tubu-w6-01): huỷ/trả đơn hoàn đúng các khoá
-- này. Cột cộng, mặc định rỗng: đơn cũ không hoàn khoá nào.
ALTER TABLE "orders" ADD COLUMN "flashLimitKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
