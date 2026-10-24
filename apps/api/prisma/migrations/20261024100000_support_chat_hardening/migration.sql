-- CreateTable
CREATE TABLE "support_retired_codes" (
    "code" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_retired_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "support_recall_tombstones" (
    "zaloMsgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_recall_tombstones_pkey" PRIMARY KEY ("zaloMsgId")
);

-- CreateIndex
CREATE INDEX "support_recall_tombstones_createdAt_idx" ON "support_recall_tombstones"("createdAt");

-- CreateIndex
CREATE INDEX "support_messages_forwardId_createdAt_idx" ON "support_messages"("forwardId", "createdAt");

-- CreateIndex
CREATE INDEX "support_messages_createdAt_idx" ON "support_messages"("createdAt");
