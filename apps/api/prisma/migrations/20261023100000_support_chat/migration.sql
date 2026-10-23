-- Chat CSKH qua nhóm Zalo (spec 2026-10-23, mục 5.3). Chỉ THÊM: 3 kiểu enum, 4 bảng support_*, không đổi bảng cũ.
-- Dữ liệu vận hành cho PROD (prod KHÔNG chạy `prisma db seed`) nối ở cuối — idempotent, DO NOTHING; seed.ts cũng createOnly.

-- CreateEnum
CREATE TYPE "SupportSender" AS ENUM ('CUSTOMER', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SupportSource" AS ENUM ('MINIAPP', 'WEB', 'ZALO', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SupportForwardStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "support_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerReadAt" TIMESTAMP(3),
    "lastOffHoursNoticeOn" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "SupportSender" NOT NULL,
    "source" "SupportSource" NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "context" JSONB,
    "clientMsgId" TEXT,
    "zaloMsgId" TEXT,
    "staffName" TEXT,
    "adminUserId" TEXT,
    "forwardId" TEXT,
    "recalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_forwards" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "SupportForwardStatus" NOT NULL DEFAULT 'PENDING',
    "zaloMsgId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "groupId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_forwards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_bridge_status" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "state" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "zaloUid" TEXT,
    "displayName" TEXT,
    "avatar" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "downAlertedAt" TIMESTAMP(3),

    CONSTRAINT "support_bridge_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_userId_key" ON "support_conversations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_code_key" ON "support_conversations"("code");

-- CreateIndex
CREATE INDEX "support_conversations_lastMessageAt_idx" ON "support_conversations"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_zaloMsgId_key" ON "support_messages"("zaloMsgId");

-- CreateIndex
CREATE INDEX "support_messages_conversationId_createdAt_id_idx" ON "support_messages"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_conversationId_clientMsgId_key" ON "support_messages"("conversationId", "clientMsgId");

-- CreateIndex
CREATE UNIQUE INDEX "support_forwards_zaloMsgId_key" ON "support_forwards"("zaloMsgId");

-- CreateIndex
CREATE INDEX "support_forwards_status_createdAt_idx" ON "support_forwards"("status", "createdAt");

-- CreateIndex
CREATE INDEX "support_forwards_conversationId_idx" ON "support_forwards"("conversationId");

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_forwards" ADD CONSTRAINT "support_forwards_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Khoá cấu hình chat.* mặc định: chat tắt cho tới khi admin kết nối cầu nối và bật.
INSERT INTO "system_configs" ("key", "value", "description", "category", "updatedAt") VALUES
  ('chat.enabled', 'false'::jsonb, 'Bật chat CSKH trong Mini App và web. Tắt thì khách không gửi được tin mới, lịch sử vẫn xem được.', 'chat', NOW()),
  ('chat.zalo_group_id', '""'::jsonb, 'Mã nhóm Zalo nhận tin chuyển từ khách (chọn ở tab Chat CSKH, không gõ tay).', 'chat', NOW()),
  ('chat.hours', '{"start":"08:00","end":"21:00"}'::jsonb, 'Giờ nhân viên trả lời chat (giờ VN, dạng HH:MM). Ngoài giờ khách nhận lời nhắn tự động một lần mỗi ngày.', 'chat', NOW()),
  ('chat.off_hours_text', '"Tubu Tree trả lời từ 8:00 đến 21:00 mỗi ngày. Tin của bạn đã được ghi lại, nhân viên sẽ trả lời khi vào giờ."'::jsonb, 'Lời nhắn tự động gửi khách khi nhắn ngoài giờ.', 'chat', NOW()),
  ('retention.support_chat_days', '365'::jsonb, 'Giữ tin chat CSKH và lần chuyển sang Zalo bao nhiêu ngày (sàn 90)', 'retention', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-support-chat-reply', 'SUPPORT_CHAT_REPLY', 'INAPP', 'Tubu Tree đã trả lời bạn: {{preview}}'),
  ('nt-ops-zalo-bridge-down', 'OPS_ZALO_BRIDGE_DOWN', 'INAPP', 'Cầu nối Zalo của chat CSKH mất kết nối từ {{since}} ({{state}}). Vào tab Chat CSKH để kết nối lại.')
ON CONFLICT DO NOTHING;
