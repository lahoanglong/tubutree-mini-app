-- Sổ cái điểm reputation cộng đồng (P1-1, docs/2026-09-08-review-progress.md).
-- Trước đây bumpReputation() increment thẳng vào community_profiles.reputation: không đếm
-- được số lần/ngày (farm không trần — mỗi bình luận +2 rep, 60 req/phút là lên top BXH trong
-- vài phút), không idempotent khi retry, và xoá bài không đảo được điểm đã cộng.
-- Mỗi dòng = 1 lần cộng/trừ; unique (userId, reason, refId) khiến gọi lại KHÔNG cộng lần 2.
CREATE TABLE IF NOT EXISTS "reputation_events" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "amount"    INTEGER NOT NULL,
    "reason"    TEXT NOT NULL,
    "refId"     TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "reputation_events_userId_reason_refId_key"
  ON "reputation_events"("userId", "reason", "refId");

-- Đếm trần theo ngày: WHERE userId = ? AND createdAt >= đầu-ngày.
CREATE INDEX IF NOT EXISTS "reputation_events_userId_createdAt_idx"
  ON "reputation_events"("userId", "createdAt");

ALTER TABLE "reputation_events"
  ADD CONSTRAINT "reputation_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ẩn mềm bình luận (P1-3): trước đây KHÔNG có đường nào gỡ 1 bình luận bị báo cáo —
-- hub kiểm duyệt chỉ hiện nút ẩn cho bài viết vì backend không có endpoint cho comment.
ALTER TABLE "feed_comments"
  ADD COLUMN IF NOT EXISTS "isRemoved" BOOLEAN NOT NULL DEFAULT false;
