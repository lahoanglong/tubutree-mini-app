-- AlterTable
ALTER TABLE "feed_posts" ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "feed_posts_status_isPinned_likeCount_createdAt_idx" ON "feed_posts"("status", "isPinned" DESC, "likeCount" DESC, "createdAt" DESC);

-- Backfill từ dữ liệu hiện có (chỉ bài có tim nên cập nhật ít dòng).
UPDATE "feed_posts" p
SET "likeCount" = r.n
FROM (SELECT "postId", COUNT(*)::int AS n FROM "feed_reactions" GROUP BY "postId") r
WHERE r."postId" = p."id";
