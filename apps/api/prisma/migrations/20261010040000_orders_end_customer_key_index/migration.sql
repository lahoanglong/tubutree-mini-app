-- C-101: cron retention đêm tra "khách cũ" của đơn lên hộ theo endCustomerKey. Không có index thì mỗi đêm
-- có đơn lên hộ là một lần Seq Scan toàn bộ orders. Partial index: chỉ đơn lên hộ (số ít), khớp đúng
-- điều kiện (placedForCustomer AND endCustomerKey IS NOT NULL) của truy vấn.
-- Additive, không đổi dữ liệu. Prisma không biểu diễn được partial index: đừng `db push`.
CREATE INDEX IF NOT EXISTS "orders_end_customer_key_proxy_idx"
  ON "orders" ("endCustomerKey")
  WHERE "placedForCustomer" AND "endCustomerKey" IS NOT NULL;
