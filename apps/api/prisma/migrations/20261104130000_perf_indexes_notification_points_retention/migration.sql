-- D4: znsHealth (ops-health) đếm + gom nhóm tin ZNS FAILED 24 giờ mỗi 5 phút.
CREATE INDEX IF NOT EXISTS "notification_logs_zns_failed_sentAt_idx"
  ON "notification_logs" ("sentAt") WHERE "channel" = 'ZNS' AND "status" = 'FAILED';

-- Trang admin mẫu tin 30 ngày và retention lọc theo khoảng sentAt.
CREATE INDEX IF NOT EXISTS "notification_logs_sentAt_idx" ON "notification_logs" ("sentAt");

-- D5: creditOrderPoints dò (reason, refId, refType='ORDER'); index này tránh quét tuần tự bảng sổ điểm.
CREATE INDEX IF NOT EXISTS "points_transactions_order_refId_idx"
  ON "points_transactions" ("refId") WHERE "refType" = 'ORDER';

-- D10: data-retention xoá theo lô WHERE <cột thời gian> < cutoff LIMIT n.
CREATE INDEX IF NOT EXISTS "pancake_webhook_events_receivedAt_idx" ON "pancake_webhook_events" ("receivedAt");
CREATE INDEX IF NOT EXISTS "gomdon_webhook_events_receivedAt_idx" ON "gomdon_webhook_events" ("receivedAt");
CREATE INDEX IF NOT EXISTS "oa_inbound_messages_createdAt_idx" ON "oa_inbound_messages" ("createdAt");
CREATE INDEX IF NOT EXISTS "analytics_events_receivedAt_idx" ON "analytics_events" ("receivedAt");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expiresAt_idx" ON "refresh_tokens" ("expiresAt");
-- Điều kiện xoá refresh_tokens là (revokedAt < cutoff) OR (expiresAt < cutoff): cần cả hai nhánh có index để planner dùng BitmapOr.
CREATE INDEX IF NOT EXISTS "refresh_tokens_revokedAt_idx" ON "refresh_tokens" ("revokedAt") WHERE "revokedAt" IS NOT NULL;
