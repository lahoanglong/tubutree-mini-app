-- Nghị định 253/2026/NĐ-CP (khoản 2 Điều 50, hiệu lực 01/07/2026): luật khấu trừ thuế TNCN 10% khi trả từ 5.000.000đ/lần cho cá nhân
-- không ký hợp đồng lao động, thay ngưỡng 2.000.000đ của Thông tư 111/2013. Mã Tubu Tree cộng dồn theo tháng giờ VN (CHẶT HƠN luật,
-- cố ý để không chia nhỏ lần chuyển né thuế) nhưng lấy chính con số 5.000.000đ này làm ngưỡng của tổng tháng.
-- Chỉ nâng khi giá trị còn đúng 2.000.000 (admin đã đặt số khác thì giữ) và ghi một dòng system_config_history cho lần đổi (chỉ khi
-- UPDATE thực sự đổi dòng; id cố định nên chạy lại không ghi thêm). Mô tả: bản seed createOnly nên DB đang chạy còn chữ "rút"; chỉ
-- đổi khi còn nguyên một trong hai bản cũ. Chạy lại an toàn: lần sau không còn dòng khớp.
WITH changed AS (
  UPDATE "system_configs"
  SET "value" = '5000000'::jsonb, "updatedAt" = now()
  WHERE "key" = 'affiliate.pit_withhold_threshold'
    AND "value" = '2000000'::jsonb
  RETURNING "key"
)
INSERT INTO "system_config_history" ("id", "key", "oldValue", "newValue", "changedBy")
SELECT 'sch_pit5m_' || md5("key"), "key", '2000000'::jsonb, '5000000'::jsonb, 'migration:pit_threshold_5m'
FROM changed
ON CONFLICT ("id") DO NOTHING;

UPDATE "system_configs"
SET "description" = 'Tổng hoa hồng chuyển vào Ví trong tháng (giờ VN) từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)'
WHERE "key" = 'affiliate.pit_withhold_threshold'
  AND "description" IN (
    'Lần rút hoa hồng từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)',
    'Tổng hoa hồng rút trong tháng (giờ VN) từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)'
  );

-- Lệnh rút ngân hàng đã bỏ: tin từ chối lệnh cũ không còn mời "gửi lệnh mới". Chỉ đổi khi còn đúng bản seed cũ.
UPDATE "notification_templates"
SET "bodyTemplate" = 'Lệnh rút {{amount}} chưa được duyệt: {{reason}}. Hoa hồng đã trả lại số dư khả dụng, bạn có thể chuyển vào Ví Tubu trong mục CTV.'
WHERE "code" = 'COMMISSION_PAYOUT_REJECTED'
  AND "bodyTemplate" = 'Lệnh rút {{amount}} chưa được duyệt: {{reason}}. Hoa hồng đã trả lại số dư khả dụng, bạn kiểm tra rồi gửi lệnh mới nhé.';
