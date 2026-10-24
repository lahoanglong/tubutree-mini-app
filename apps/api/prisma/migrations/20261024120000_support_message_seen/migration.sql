-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN "seenAt" TIMESTAMP(3);

-- Tin STAFF/SYSTEM đã nằm trước mốc đọc cũ của hội thoại coi như đã thấy.
UPDATE "support_messages" m
SET "seenAt" = c."customerReadAt"
FROM "support_conversations" c
WHERE m."conversationId" = c."id"
  AND c."customerReadAt" IS NOT NULL
  AND m."sender" IN ('STAFF', 'SYSTEM')
  AND m."createdAt" <= c."customerReadAt";
