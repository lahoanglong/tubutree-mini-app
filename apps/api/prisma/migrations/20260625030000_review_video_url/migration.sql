-- Review video (UGC §6.14.9): cho phép đính kèm 1 video vào đánh giá.
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;
