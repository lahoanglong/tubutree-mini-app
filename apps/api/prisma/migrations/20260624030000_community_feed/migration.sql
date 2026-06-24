-- Community Feed (§6.14.12) — bảng tin cộng đồng Vườn Xanh: bài viết + thả tim + bình luận.

CREATE TYPE "FeedPostKind" AS ENUM ('MANUAL', 'HARVEST', 'MILESTONE', 'SPECIES');

CREATE TABLE "feed_posts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "FeedPostKind" NOT NULL DEFAULT 'MANUAL',
    "body" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feed_posts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "feed_posts_createdAt_idx" ON "feed_posts"("createdAt");
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "feed_reactions" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feed_reactions_pkey" PRIMARY KEY ("id")
);
-- Mỗi user 1 tim/bài (chống đếm trùng).
CREATE UNIQUE INDEX "feed_reactions_postId_userId_key" ON "feed_reactions"("postId", "userId");
CREATE INDEX "feed_reactions_postId_idx" ON "feed_reactions"("postId");
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "feed_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feed_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "feed_comments_postId_idx" ON "feed_comments"("postId");
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
