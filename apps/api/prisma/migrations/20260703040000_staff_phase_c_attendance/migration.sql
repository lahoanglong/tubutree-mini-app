-- CreateEnum
CREATE TYPE "SessionCloseReason" AS ENUM ('MANUAL', 'OUT_OF_RANGE', 'STALE', 'SHIFT_END', 'ADMIN');

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "checkinAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkoutAt" TIMESTAMP(3),
    "checkinLat" DOUBLE PRECISION NOT NULL,
    "checkinLng" DOUBLE PRECISION NOT NULL,
    "checkinIp" TEXT NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closeReason" "SessionCloseReason",
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sessions_shiftId_idx" ON "attendance_sessions"("shiftId");

-- CreateIndex
CREATE INDEX "attendance_sessions_staffId_checkoutAt_idx" ON "attendance_sessions"("staffId", "checkoutAt");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
