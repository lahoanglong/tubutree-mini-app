-- Phiên bản thể lệ do admin đặt; mặc định đúng bằng hằng số cũ nên sau deploy không ai phải đồng ý lại.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('waste.rules_version', '"2026-10-17.1"'::jsonb, 'Số phiên bản thể lệ, tối đa 32 ký tự. Đổi số này khi sửa nội dung thể lệ để khách đồng ý lại.', 'waste', NOW())
ON CONFLICT ("key") DO NOTHING;
