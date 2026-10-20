-- Mẫu thông báo đại lý khi được trả bù thưởng doanh số quý cho đơn chốt muộn
-- (DealerService.topUpQuarterlyBonuses). Không đổi schema: dòng sổ dùng refType mới QUARTER_BONUS_TOPUP
-- trên cột chuỗi sẵn có, unique (userId, refType, refId) đã có.
-- Dữ liệu vận hành cho PROD (prod KHÔNG chạy `prisma db seed`) — idempotent, DO NOTHING: không ghi đè
-- nội dung admin đã chỉnh (seed.ts cũng createOnly cho mẫu này).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-dealer-bonus-topup', 'DEALER_BONUS_TOPUP', 'INAPP', 'Trả bù thưởng doanh số {{quarter}}: có đơn của quý chốt sau ngày chốt thưởng, bạn được cộng thêm {{amount}}đ vào công nợ đại lý (doanh số đã chốt {{revenue}}đ). Cảm ơn bạn đã đồng hành cùng Tubu Tree 🌿')
ON CONFLICT DO NOTHING;
