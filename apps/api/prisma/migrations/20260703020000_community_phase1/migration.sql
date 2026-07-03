-- CreateEnum
CREATE TYPE "FeedPostStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'REMOVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FeedPostKind" ADD VALUE 'QUESTION';
ALTER TYPE "FeedPostKind" ADD VALUE 'SHOWCASE';
ALTER TYPE "FeedPostKind" ADD VALUE 'TIP';

-- DropIndex
DROP INDEX "feed_posts_createdAt_idx";

-- AlterTable
ALTER TABLE "feed_comments" ADD COLUMN     "isAccepted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "feed_posts" ADD COLUMN     "bestCommentId" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "images" TEXT[],
ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "FeedPostStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "title" TEXT,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "community_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "community_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_product_tags" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_product_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_categories_slug_key" ON "community_categories"("slug");

-- CreateIndex
CREATE INDEX "post_product_tags_productId_idx" ON "post_product_tags"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "post_product_tags_postId_productId_key" ON "post_product_tags"("postId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "feed_posts_bestCommentId_key" ON "feed_posts"("bestCommentId");

-- CreateIndex
CREATE INDEX "feed_posts_status_createdAt_idx" ON "feed_posts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "feed_posts_categoryId_status_createdAt_idx" ON "feed_posts"("categoryId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "feed_posts_kind_status_createdAt_idx" ON "feed_posts"("kind", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "feed_posts" ADD CONSTRAINT "feed_posts_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "community_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_product_tags" ADD CONSTRAINT "post_product_tags_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_product_tags" ADD CONSTRAINT "post_product_tags_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotency thưởng xu cộng đồng: 1 reason chỉ được cấp 1 lần khi refType='COMMUNITY'.
CREATE UNIQUE INDEX "coin_transactions_community_reason_key"
  ON "coin_transactions"("reason") WHERE "refType" = 'COMMUNITY';
