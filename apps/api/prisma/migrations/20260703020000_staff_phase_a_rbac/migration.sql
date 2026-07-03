-- CreateEnum
CREATE TYPE "RoleGrantRole" AS ENUM ('STAFF', 'ADMIN');

-- CreateTable
CREATE TABLE "role_grants" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "RoleGrantRole" NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "note" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_grants_phone_revokedAt_idx" ON "role_grants"("phone", "revokedAt");
