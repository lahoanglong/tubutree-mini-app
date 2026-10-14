-- R5 merchant: mẫu thông báo cho bản sửa nội dung của sản phẩm đang bán (prod không chạy seed). Chỉ THÊM mẫu mới (DO NOTHING
-- bỏ qua cả trùng id lẫn trùng code, không ghi đè bản admin đã sửa).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ops-merchant-product-edit', 'OPS_MERCHANT_PRODUCT_EDIT_PENDING', 'INAPP', '📝 {{store}} sửa nội dung sản phẩm "{{product_name}}" ({{mode}}). Sản phẩm vẫn bán với nội dung cũ. Vào trang quản trị → Duyệt sản phẩm đối tác để duyệt bản sửa.'),
  ('nt-merchant-product-edit-approved', 'MERCHANT_PRODUCT_EDIT_APPROVED', 'INAPP', '✅ Bản sửa của sản phẩm "{{product_name}}" đã được duyệt và đang hiển thị trên Tubu Tree.'),
  ('nt-merchant-product-edit-rejected', 'MERCHANT_PRODUCT_EDIT_REJECTED', 'INAPP', 'Bản sửa của sản phẩm "{{product_name}}" chưa được duyệt: {{reason}}. Sản phẩm vẫn bán với nội dung cũ; bạn sửa lại trong Cổng người bán để gửi duyệt lại.')
ON CONFLICT DO NOTHING;

-- Tên gian hàng mặc định đã có chữ "Gian hàng của …": bỏ chữ "Gian hàng" cố định ở đầu mẫu để không lặp. Chỉ sửa khi mẫu còn
-- đúng bản gốc, không đè bản admin đã chỉnh.
UPDATE "notification_templates"
   SET "bodyTemplate" = '📦 {{store}} gửi sản phẩm "{{product_name}}" ({{mode}}) chờ duyệt. Vào trang quản trị → Duyệt sản phẩm đối tác.'
 WHERE "code" = 'OPS_MERCHANT_PRODUCT_PENDING' AND "channel" = 'INAPP'
   AND "bodyTemplate" = '📦 Gian hàng {{store}} gửi sản phẩm "{{product_name}}" ({{mode}}) chờ duyệt. Vào trang quản trị → Duyệt sản phẩm đối tác.';
