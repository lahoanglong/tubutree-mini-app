-- Giữ chân dữ liệu xoá cashback_clicks theo "clickedAt" (data-retention.service); không chỉ mục thì mỗi lượt quét đọc cả bảng.
-- CREATE INDEX thường (migrate chạy trong giao dịch nên không CONCURRENTLY); bảng nhỏ, chỉ chặn ghi trong chốc lát.
CREATE INDEX "cashback_clicks_clickedAt_idx" ON "cashback_clicks"("clickedAt");
