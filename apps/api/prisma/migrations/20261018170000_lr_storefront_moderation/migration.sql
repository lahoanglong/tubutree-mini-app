-- D3-02: kiểm duyệt gian hàng. Admin duyệt lần đầu (tick xanh) và gỡ đăng kèm lý do; chủ không đăng lại được khi đang bị gỡ.
ALTER TABLE "storefronts"
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "takenDownAt" TIMESTAMP(3),
  ADD COLUMN "takenDownReason" TEXT,
  ADD COLUMN "takenDownById" TEXT;

-- Mẫu thông báo cho chủ gian hàng (prod không chạy seed). Chỉ THÊM mẫu mới, không ghi đè bản admin đã sửa.
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-storefront-taken-down', 'STOREFRONT_TAKEN_DOWN', 'INAPP', 'Tubu Tree đã gỡ gian hàng "{{store}}" khỏi trang công khai: {{reason}}. Bạn vẫn xem và sửa được gian hàng trong ứng dụng; liên hệ CSKH nếu cần được xem xét lại.'),
  ('nt-storefront-reinstated', 'STOREFRONT_REINSTATED', 'INAPP', 'Gian hàng "{{store}}" của bạn đã được Tubu Tree xem xét và hiển thị lại với khách.'),
  ('nt-storefront-approved', 'STOREFRONT_APPROVED', 'INAPP', 'Gian hàng "{{store}}" của bạn đã được Tubu Tree duyệt: trang công khai có dấu tích xanh và nhãn "CTV tuyển chọn".')
ON CONFLICT DO NOTHING;
