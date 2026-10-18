-- Bộ lọc danh sách đơn admin (D1-17): loại đơn, tình trạng thanh toán, nền tảng. Mỗi bộ lọc có index đi kèm createdAt để
-- "ORDER BY createdAt LIMIT n" dừng sớm khi lọc theo giá trị hiếm (đơn đại lý, CTV lên hộ, web, hoàn tiền...) thay vì quét
-- ngược cả orders_createdAt_idx. Đo trên 300k đơn tổng hợp: đại lý + thất bại + web 63 ms -> 6 ms; CTV lên hộ 2,5 ms -> 0,13 ms.
-- Loại "qua CTV" / "qua gian hàng" (referrerUserId / storefrontId khác NULL) và lọc theo một CTV hay một gian hàng dùng
-- index sẵn có ([referrerUserId], [storefrontId, createdAt]) và quét ngược createdAt: đo không có lợi khi thêm index riêng.
CREATE INDEX IF NOT EXISTS "orders_paymentStatus_createdAt_idx" ON "orders"("paymentStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_type_createdAt_idx" ON "orders"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_platform_createdAt_idx" ON "orders"("platform", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_placedForCustomer_createdAt_idx" ON "orders"("placedForCustomer", "createdAt");
