-- C-017: cột đánh dấu đơn đã được mời đánh giá (nullable, không backfill: cron chỉ xét đơn giao trong vài ngày gần
-- nhất nên đơn cũ để NULL không bị gửi tin hàng loạt) + hai mẫu tin mới.
ALTER TABLE "orders" ADD COLUMN "reviewInvitedAt" TIMESTAMP(3);

-- Prod không chạy `prisma db seed`; DO NOTHING (không đích cụ thể) bỏ qua cả trùng id lẫn trùng code, không ghi đè nội
-- dung admin đã chỉnh. Cùng nội dung với prisma/seed.ts.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-second-order', 'SECOND_ORDER_VOUCHER', 'INAPP', 'Cảm ơn bạn đã tin dùng Tubu Tree! Tặng mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}} cho đơn tiếp theo, dùng trước {{expires}} 🌿'),
  ('nt-review-request', 'REVIEW_REQUEST', 'INAPP', 'Đơn {{order_code}} đã đến tay bạn. Bạn thấy {{product}} thế nào? Viết đánh giá để giúp người mua sau, lần đầu đánh giá mỗi sản phẩm được cộng Điểm Xanh 🌿')
ON CONFLICT DO NOTHING;
