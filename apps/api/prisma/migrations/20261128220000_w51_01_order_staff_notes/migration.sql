SET LOCAL lock_timeout = '5s';
-- Gói w51-01: ghi chú nội bộ CSKH/Admin cho kho trên đơn còn mở (PUT /admin/orders/:id/staff-note).
-- Bảng mới, không thêm cột vào "orders": các đường trả nguyên dòng Order cho khách/đại lý/CTV/gian hàng không thể kéo theo ghi chú.
-- Chỉ thêm: bảng rỗng + khoá ngoại tới orders. Lúc thêm khoá ngoại Postgres giữ khoá SHARE ROW EXCLUSIVE trên "orders" trong tích tắc
-- (bảng mới rỗng nên không phải quét kiểm). Khoá đó phải chờ transaction đang ghi "orders": lock_timeout 5 giây để migration hỏng sớm
-- (chạy lại được) thay vì xếp hàng làm treo checkout. Image cũ vẫn chạy đúng: không đọc, không ghi bảng này.

-- CreateTable
CREATE TABLE "order_staff_notes" (
    "orderId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_staff_notes_pkey" PRIMARY KEY ("orderId")
);

-- AddForeignKey
ALTER TABLE "order_staff_notes" ADD CONSTRAINT "order_staff_notes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
