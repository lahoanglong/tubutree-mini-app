-- CreateEnum
CREATE TYPE "PayrollMonthStatus" AS ENUM ('OPEN', 'FINALIZED', 'PAID');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('LATE', 'LATE_CANCEL', 'MANUAL');

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hourlyRate" INTEGER NOT NULL DEFAULT 0,
    "bankBin" TEXT,
    "bankAccountNo" TEXT,
    "bankAccountName" TEXT,
    "qrImageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_userId_key" ON "staff_profiles"("userId");

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "shiftId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_adjustments_staffId_workDate_idx" ON "payroll_adjustments"("staffId", "workDate");

-- CreateIndex
CREATE INDEX "payroll_adjustments_shiftId_type_idx" ON "payroll_adjustments"("shiftId", "type");

-- CreateTable
CREATE TABLE "payroll_days" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "hourlyRate" INTEGER NOT NULL DEFAULT 0,
    "gross" INTEGER NOT NULL DEFAULT 0,
    "fines" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_days_staffId_workDate_key" ON "payroll_days"("staffId", "workDate");

-- CreateTable
CREATE TABLE "payroll_months" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "gross" INTEGER NOT NULL DEFAULT 0,
    "totalFines" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL DEFAULT 0,
    "status" "PayrollMonthStatus" NOT NULL DEFAULT 'OPEN',
    "finalizedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "proofImageUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_months_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_months_staffId_year_month_key" ON "payroll_months"("staffId", "year", "month");

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
