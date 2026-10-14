-- AlterEnum
ALTER TYPE "CustomerRefundKind" ADD VALUE 'OVERPAYMENT';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pancakePaidReported" INTEGER;

-- AlterTable
ALTER TABLE "payment_attempts" ADD COLUMN     "succeededAt" TIMESTAMP(3);

-- Đơn ZaloPay đã nhận tiền mà chỉ có một lần thử: lần đó là khoản đã lật PAID. Đơn nhiều lần thử tạo trước cột này
-- không biết lần nào trả nên để trống — callback lạ của chúng vào "Cần xử lý" thay vì tự tạo khoản hoàn.
UPDATE "payment_attempts" pa
SET "succeededAt" = COALESCE(o."paidAt", o."updatedAt")
FROM "orders" o
WHERE pa."orderId" = o."id"
  AND o."paymentStatus" IN ('PAID', 'REFUNDED')
  AND (SELECT COUNT(*) FROM "payment_attempts" x WHERE x."orderId" = o."id") = 1;

-- Prod không chạy `prisma db seed`: mẫu tin mới đi bằng migration, cùng nội dung với prisma/seed.ts.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-refund-overpayment', 'REFUND_OVERPAYMENT', 'INAPP', 'Tubu đã nhận thêm {{amount}} cho đơn {{order_code}}, nhiều hơn số tiền của đơn. Vào chi tiết đơn để chọn nhận lại khoản này về Ví Tubu (ngay) hoặc tài khoản ngân hàng (1-3 ngày làm việc, miễn phí).')
ON CONFLICT DO NOTHING;
