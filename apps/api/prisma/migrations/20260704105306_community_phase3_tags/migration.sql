-- CreateTable
CREATE TABLE "community_tags" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "community_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_tags" (
    "postId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "post_tags_pkey" PRIMARY KEY ("postId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_tags_slug_key" ON "community_tags"("slug");

-- CreateIndex
CREATE INDEX "post_tags_tagId_idx" ON "post_tags"("tagId");

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_postId_fkey" FOREIGN KEY ("postId") REFERENCES "feed_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "community_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
