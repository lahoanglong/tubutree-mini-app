-- Hai chốt chặn gõ nhầm khi thêm flash sale (R4-ADMIN-11): giá flash không giảm quá max_discount_pct so với giá
-- đang bán (0.9 = giá flash tối thiểu 10% giá bán; 1 = không chặn), một đợt dài tối đa max_duration_days ngày.
-- Prod không chạy prisma db seed nên thêm dòng ở đây để admin thấy và sửa được trong trang Cấu hình.
-- Idempotent: DO NOTHING để không đè giá trị admin đã chỉnh.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('flashsale.max_discount_pct', '0.9'::jsonb, 'Mức giảm tối đa của giá flash so với giá đang bán (phân số; 0.9 = giá flash ≥ 10% giá bán, 1 = không chặn)', 'flashsale', now()),
  ('flashsale.max_duration_days', '31'::jsonb, 'Số ngày tối đa của một đợt flash sale', 'flashsale', now())
ON CONFLICT ("key") DO NOTHING;
