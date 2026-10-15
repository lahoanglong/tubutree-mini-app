-- CreateTable
CREATE TABLE "cron_leases" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_leases_pkey" PRIMARY KEY ("name")
);
