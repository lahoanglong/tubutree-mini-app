-- C-094: tab Đơn hàng của admin có bộ lọc "Đơn yêu cầu VAT" (invoiceStatus REQUESTED/ISSUED/FAILED). Không có
-- index thì mỗi lần mở là quét ngược orders_createdAt_idx qua cả bảng vì đơn VAT chỉ chiếm số ít. Partial index
-- chỉ chứa đơn có yêu cầu VAT, đúng vị từ của truy vấn (INVOICE_STATUS_WHERE trong admin-order-filter.ts).
-- Additive, không đổi dữ liệu. Prisma không biểu diễn được partial index: đừng `db push`.
CREATE INDEX IF NOT EXISTS "orders_invoice_open_idx"
  ON "orders" ("createdAt" DESC)
  WHERE "invoiceStatus" IN ('REQUESTED', 'ISSUED', 'FAILED');
