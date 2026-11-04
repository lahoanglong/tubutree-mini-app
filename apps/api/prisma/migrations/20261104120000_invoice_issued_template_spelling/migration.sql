-- Mẫu INVOICE_ISSUED chưa từng có migration: PROD giữ chữ từ lần prisma:seed bản thử cb92dc8 ("Hóa đơn", bỏ dấu kiểu cũ),
-- seed sau đó đổi sang "Hoá đơn" nhưng seed:reference không ghi đè mẫu đã có. Chỉ đổi khi nội dung đúng từng byte bản cũ,
-- bản admin đã sửa tay giữ nguyên. Idempotent. Lời mới trùng từng chữ với prisma/seed.ts.

UPDATE "notification_templates" SET "bodyTemplate" = 'Hoá đơn VAT cho đơn {{order_code}} đã được phát hành.'
WHERE "code" = 'INVOICE_ISSUED'
  AND "bodyTemplate" = 'Hóa đơn VAT cho đơn {{order_code}} đã được phát hành.';
