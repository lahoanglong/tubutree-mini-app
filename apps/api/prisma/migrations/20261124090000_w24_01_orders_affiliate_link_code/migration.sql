-- Mã link CTV (affiliate_links.shortCode) mà khách mở trước khi đặt đơn: cho số đơn và doanh số theo từng link (PO A4, 23/11/2026).
-- Chỉ thêm một cột rỗng và một chỉ mục: image cũ không biết cột này vẫn đọc/ghi đơn như trước, rollback image không cần gỡ migration.
-- Không khoá ngoại tới affiliate_links: đơn giữ mã kể cả khi link bị xoá, và ghi đơn không phải chờ khoá dòng link.
ALTER TABLE "orders" ADD COLUMN "affiliateLinkCode" TEXT;

CREATE INDEX "orders_affiliateLinkCode_idx" ON "orders"("affiliateLinkCode");
