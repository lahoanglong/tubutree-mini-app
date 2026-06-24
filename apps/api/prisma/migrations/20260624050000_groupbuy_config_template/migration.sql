-- Dữ liệu vận hành cho PROD (prod KHÔNG chạy `prisma db seed`):
-- config Lô đất (§6.7) + Mua chung (§6.14.8) + template thông báo GROUP_BUY_SUCCESS.
-- Idempotent: configs DO NOTHING (không ghi đè giá trị admin đã tinh chỉnh),
-- template DO UPDATE (đảm bảo nội dung đúng). Trùng với seed.ts cho DB dev — vô hại.

INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('game.max_plots', '5'::jsonb, 'Số lô đất tối đa/user (gồm lô nhà)', 'game', now()),
  ('game.plot_unlock_seed_base', '100'::jsonb, '💧 mở lô đất (giá = base × số thứ tự lô)', 'game', now()),
  ('game.plot_unlock_xu_base', '200'::jsonb, 'Xu mở lô đất (giá = base × số thứ tự lô)', 'game', now()),
  ('game.plot_target', '600'::jsonb, '💧 cần để thu hoạch 1 cây ở lô phụ', 'game', now()),
  ('groupbuy.discount_pct', '15'::jsonb, '% giảm giá khi mua chung đủ người', 'groupbuy', now()),
  ('groupbuy.target_size', '3'::jsonb, 'Số người cần để nhóm mua chung thành công', 'groupbuy', now()),
  ('groupbuy.window_hours', '48'::jsonb, 'Số giờ nhóm mua chung mở trước khi hết hạn', 'groupbuy', now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-groupbuy-ok', 'GROUP_BUY_SUCCESS', 'INAPP', '🎉 Nhóm mua chung đã đủ người! Bạn nhận mã giảm {{discount}}đ để mua với giá nhóm. Đặt hàng ngay nhé 🛒')
ON CONFLICT ("id") DO UPDATE SET "code" = EXCLUDED."code", "channel" = EXCLUDED."channel", "bodyTemplate" = EXCLUDED."bodyTemplate";
