-- Mẫu thông báo đại lý khi thưởng doanh số quý bị thu hồi do đơn bị huỷ/trả
-- (DealerService.clawbackQuarterBonusForOrder → notifyBonusAdjustedAfterCommit, chỉ gửi SAU KHI
-- transaction huỷ/trả đơn đã commit). Không đổi schema.
-- Dữ liệu vận hành cho PROD (prod KHÔNG chạy `prisma db seed`) — idempotent, DO NOTHING: không ghi đè
-- nội dung admin đã chỉnh (seed.ts cũng createOnly cho mẫu này).
INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-dealer-bonus-adjusted', 'DEALER_BONUS_ADJUSTED', 'INAPP', 'Thưởng doanh số {{quarter}} đã được điều chỉnh do đơn {{order_code}} bị huỷ/trả: thu hồi {{amount}}đ (cộng lại vào công nợ đại lý). Thưởng {{quarter}} còn lại: {{remaining}}đ. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.')
ON CONFLICT DO NOTHING;
