-- Họ token refresh: logout thu hồi theo họ (L1-03). Chỉ thêm cột và index.
ALTER TABLE "refresh_tokens" ADD COLUMN "parentId" TEXT;
CREATE INDEX "refresh_tokens_parentId_idx" ON "refresh_tokens"("parentId");
