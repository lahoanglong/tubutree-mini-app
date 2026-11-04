-- D4: znsHealth (ops-health) đếm + gom nhóm tin ZNS FAILED 24 giờ mỗi 5 phút.
CREATE INDEX IF NOT EXISTS "notification_logs_zns_failed_sentAt_idx"
  ON "notification_logs" ("sentAt") WHERE "channel" = 'ZNS' AND "status" = 'FAILED';

-- Trang admin mẫu tin 30 ngày và retention lọc theo khoảng sentAt. Dòng chèn theo thời gian nên BRIN gọn và đủ dùng.
CREATE INDEX IF NOT EXISTS "notification_logs_sentAt_brin" ON "notification_logs" USING BRIN ("sentAt");

-- D5: creditOrderPoints dò (reason, refId, refType='ORDER'); refId đứng đầu để không quét tuần tự bảng sổ điểm.
CREATE INDEX IF NOT EXISTS "points_transactions_order_refId_idx"
  ON "points_transactions" ("refId") WHERE "refType" = 'ORDER';

-- D10: data-retention xoá theo lô WHERE <cột thời gian> < cutoff LIMIT n.
CREATE INDEX IF NOT EXISTS "pancake_webhook_events_receivedAt_brin" ON "pancake_webhook_events" USING BRIN ("receivedAt");
CREATE INDEX IF NOT EXISTS "gomdon_webhook_events_receivedAt_brin" ON "gomdon_webhook_events" USING BRIN ("receivedAt");
CREATE INDEX IF NOT EXISTS "oa_inbound_messages_createdAt_brin" ON "oa_inbound_messages" USING BRIN ("createdAt");
CREATE INDEX IF NOT EXISTS "analytics_events_receivedAt_brin" ON "analytics_events" USING BRIN ("receivedAt");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expiresAt_idx" ON "refresh_tokens" ("expiresAt");
-- Điều kiện xoá refresh_tokens là (revokedAt < cutoff) OR (expiresAt < cutoff): cần cả hai nhánh có index để planner dùng BitmapOr.
CREATE INDEX IF NOT EXISTS "refresh_tokens_revokedAt_idx" ON "refresh_tokens" ("revokedAt") WHERE "revokedAt" IS NOT NULL;
