-- DropIndex
DROP INDEX "payroll_adjustments_shiftId_type_idx";

-- CreateTable
CREATE TABLE "quick_reply_templates" (
    "id" TEXT NOT NULL,
    "category" TEXT,
    "keywords" TEXT[],
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isGreeting" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_reply_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_inbound_messages" (
    "id" TEXT NOT NULL,
    "zaloUserId" TEXT NOT NULL,
    "msgId" TEXT,
    "messageText" TEXT,
    "rawPayload" JSONB NOT NULL,
    "matchedTemplateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oa_inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oa_greeted_users" (
    "zaloUserId" TEXT NOT NULL,
    "greetedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oa_greeted_users_pkey" PRIMARY KEY ("zaloUserId")
);

-- CreateIndex
CREATE INDEX "quick_reply_templates_isActive_sortOrder_idx" ON "quick_reply_templates"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "oa_inbound_messages_msgId_key" ON "oa_inbound_messages"("msgId");

-- CreateIndex
CREATE INDEX "oa_inbound_messages_zaloUserId_idx" ON "oa_inbound_messages"("zaloUserId");

-- CreateIndex
CREATE INDEX "oa_inbound_messages_status_idx" ON "oa_inbound_messages"("status");

-- RenameIndex
ALTER INDEX "payroll_adjustments_shift_type_key" RENAME TO "payroll_adjustments_shiftId_type_key";
