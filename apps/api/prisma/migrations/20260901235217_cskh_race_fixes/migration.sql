-- AlterTable
ALTER TABLE "oa_inbound_messages" ADD COLUMN     "msgId" TEXT;

-- CreateTable
CREATE TABLE "oa_greeted_users" (
    "zaloUserId" TEXT NOT NULL,
    "greetedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oa_greeted_users_pkey" PRIMARY KEY ("zaloUserId")
);

-- CreateIndex
CREATE UNIQUE INDEX "oa_inbound_messages_msgId_key" ON "oa_inbound_messages"("msgId");

