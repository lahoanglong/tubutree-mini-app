-- ADMINOPS-10/11: nhóm việc của nhân viên (CSKH, KHO) và sổ việc admin làm trên một tài khoản.
-- Additive: cột mảng mặc định rỗng (nhân viên hiện có giữ đúng quyền cũ: quầy + chấm công), bảng mới.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "staffPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "user_admin_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "reason" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_admin_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_admin_events_userId_createdAt_idx" ON "user_admin_events"("userId", "createdAt");

-- Tài khoản đang bị khoá: ghi lại lần khoá hiện tại để lịch sử khoá không trống với dữ liệu cũ.
INSERT INTO "user_admin_events" ("id", "userId", "kind", "reason", "actorId", "createdAt")
SELECT 'uae_' || md5(u."id" || coalesce(u."blockedAt"::text, '')), u."id", 'BLOCK', u."blockedReason", u."blockedById", u."blockedAt"
FROM "users" u
WHERE u."isBlocked" AND u."blockedAt" IS NOT NULL;
