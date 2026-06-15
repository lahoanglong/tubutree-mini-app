-- Vườn Xanh 2.0 (social): tặng nước bạn bè
CREATE TABLE "water_gifts" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "water_gifts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "water_gifts_senderId_recipientId_dayKey_key" ON "water_gifts"("senderId", "recipientId", "dayKey");
CREATE INDEX "water_gifts_recipientId_idx" ON "water_gifts"("recipientId");

ALTER TABLE "water_gifts" ADD CONSTRAINT "water_gifts_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "water_gifts" ADD CONSTRAINT "water_gifts_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
