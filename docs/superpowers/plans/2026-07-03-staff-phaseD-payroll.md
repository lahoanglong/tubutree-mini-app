# Nhân sự — Phase D: Lương + VietQR + trả lương Implementation Plan

> REQUIRED SUB-SKILL: executing-plans.

**Goal:** Tự tính giờ công × đơn giá (theo từng NV) → lương ngày → tổng tháng; phạt trễ 10k + huỷ trễ 1h tự cộng vào; admin xem tháng, quét VietQR (bank NV) chuyển khoản, tick "đã chuyển" + upload ảnh xác nhận.

**Architecture:** `StaffProfile` (đơn giá + bank). `PayrollAdjustment` (phạt/thưởng, idempotent theo shift+type), `PayrollDay`, `PayrollMonth`. Logic tiền thuần `payroll.calc.ts` (TDD). `PayrollService` recompute ngày/tháng (fine từ `session.isLate` + `shift.cancelPenalty`). VietQR dựng lại từ `buildVietQrPayload`. Cron chốt ngày. FE trang lương NV + tab Lương admin.

## Global Constraints

- Tiền VND `Int`. `gross=round(minutes/60*rate)`; `net=max(0, gross-Σadjustment)`.
- Fine auto **idempotent**: LATE (=late_fine) & LATE_CANCEL (=hourlyRate) tạo 1 lần/shift (check shiftId+type).
- Không recompute tháng đã `FINALIZED`/`PAID`.
- `mark-paid` bắt buộc `proofImageUrl`.
- `@Roles('STAFF','ADMIN')` self; `@Roles('ADMIN')` quản lý.

## Files

- schema: `StaffProfile`, `PayrollAdjustment`, `PayrollDay`, `PayrollMonth` + enums `PayrollMonthStatus`, `AdjustmentType`; User `staffProfile`.
- migration `20260703050000_staff_phase_d_payroll`.
- `payroll/payroll.calc.ts` (+spec) — computeDayPay + sumWorkedMinutes.
- `payroll/payroll.service.ts` (+spec).
- `payroll/payroll.dto.ts`.
- `payroll/payroll.controller.ts` (self) + `payroll/admin-payroll.controller.ts`.
- `payroll/payroll.job.ts` (cron chốt ngày).
- FE `payroll-api.ts`, trang `my-payroll.tsx`, tab Lương trong `admin.tsx`, entry profile, route.

---

### Task 1: Schema + migration

```prisma
enum PayrollMonthStatus { OPEN FINALIZED PAID }
enum AdjustmentType { LATE LATE_CANCEL MANUAL }

model StaffProfile {
  id              String   @id @default(cuid())
  userId          String   @unique
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  hourlyRate      Int      @default(0)
  bankBin         String?
  bankAccountNo   String?
  bankAccountName String?
  qrImageUrl      String?
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@map("staff_profiles")
}

model PayrollAdjustment {
  id        String         @id @default(cuid())
  staffId   String
  workDate  DateTime       @db.Date
  type      AdjustmentType
  amount    Int            // dương=trừ; MANUAL âm=thưởng
  reason    String
  shiftId   String?
  createdBy String?
  createdAt DateTime       @default(now())
  @@index([staffId, workDate])
  @@index([shiftId, type])
  @@map("payroll_adjustments")
}

model PayrollDay {
  id            String    @id @default(cuid())
  staffId       String
  workDate      DateTime  @db.Date
  workedMinutes Int       @default(0)
  hourlyRate    Int       @default(0)
  gross         Int       @default(0)
  fines         Int       @default(0)
  net           Int       @default(0)
  finalizedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  @@unique([staffId, workDate])
  @@map("payroll_days")
}

model PayrollMonth {
  id            String             @id @default(cuid())
  staffId       String
  year          Int
  month         Int
  totalMinutes  Int                @default(0)
  gross         Int                @default(0)
  totalFines    Int                @default(0)
  net           Int                @default(0)
  status        PayrollMonthStatus @default(OPEN)
  finalizedAt   DateTime?
  paidAt        DateTime?
  paidBy        String?
  proofImageUrl String?
  note          String?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt
  @@unique([staffId, year, month])
  @@map("payroll_months")
}
```

User thêm `staffProfile StaffProfile?`. Migration SQL tương ứng (DATE, Int, enums, unique indexes). generate + commit.

---

### Task 2: `payroll.calc.ts` — TDD

```typescript
import { overlapMinutes } from '../shifts/time.util';

export interface SessionLike { checkinAt: Date; checkoutAt: Date | null; }
export interface ShiftWindow { effStart: Date; effEnd: Date; sessions: SessionLike[]; }

/** Tổng phút làm = Σ overlap(session đã đóng, cửa sổ ca duyệt). Session mở bỏ qua. */
export function sumWorkedMinutes(windows: ShiftWindow[]): number {
  let total = 0;
  for (const w of windows) {
    for (const s of w.sessions) {
      if (!s.checkoutAt) continue;
      total += overlapMinutes(s.checkinAt, s.checkoutAt, w.effStart, w.effEnd);
    }
  }
  return total;
}

export interface AdjLike { amount: number; }
export function computeDayPay(minutes: number, rate: number, adjustments: AdjLike[]) {
  const gross = Math.round((minutes / 60) * rate);
  const adjTotal = adjustments.reduce((s, a) => s + a.amount, 0);
  const fines = adjustments.reduce((s, a) => (a.amount > 0 ? s + a.amount : s), 0);
  const net = Math.max(0, gross - adjTotal);
  return { workedMinutes: minutes, hourlyRate: rate, gross, fines, net };
}
```

Test: sumWorkedMinutes (session trong/cắt biên/mở bỏ qua/nhiều ca); computeDayPay (gross làm tròn, fines chỉ dương, MANUAL âm tăng net, net≥0).

---

### Task 3: `PayrollService` — recompute + fines + admin

Methods:
- `private effWindow(shift)` → {effStart, effEnd}.
- `async ensureFines(staffId, workDate, rate)`: shifts ngày đó; mỗi shift: có session isLate → ensure LATE(late_fine); cancelPenalty → ensure LATE_CANCEL(rate). Idempotent (findFirst shiftId+type).
- `async recomputeDay(staffId, workDate)`: rate = profile.hourlyRate; ensureFines; load shifts(+sessions closed) → windows; minutes=sumWorkedMinutes; adjustments (staffId+workDate); computeDayPay; upsert PayrollDay.
- `async recomputeStaffMonth(staffId, year, month)`: nếu month PAID/FINALIZED → chỉ đọc, bỏ recompute; else: distinct workDates (shifts ∪ adjustments trong tháng) → recomputeDay; sum PayrollDays → upsert PayrollMonth (giữ status/proof).
- Self: `getMyPayroll(staffId, year, month)` → recompute + trả {days, month, profile}. `updateBank(staffId, dto)` upsert StaffProfile.
- Admin: `setRate(userId, rate)` upsert; `adminMonth(year, month)` → mọi StaffProfile/tất cả NV STAFF/ADMIN → recompute + build qrImageUrl; `finalize(staffId,y,m)`; `markPaid(staffId,y,m,proofImageUrl,note,adminId)` (require proof, guard FINALIZED→PAID hoặc OPEN→PAID); `adjust(staffId, workDate, amount, reason, adminId)` create MANUAL + recomputeDay.

Test (mock prisma): ensureFines tạo LATE khi có isLate, không tạo trùng; recomputeDay upsert đúng gross/net; markPaid thiếu proof → BadRequest; recompute bỏ qua tháng PAID.

VietQR: `buildQr(bank, amount, memo)` dùng `buildVietQrPayload` + URL img.vietqr.io (bin-accountNo-compact2.png?amount&addInfo&accountName). Ưu tiên `profile.qrImageUrl` nếu có.

---

### Task 4: DTO + controllers + cron + module

- DTO: UpdateBankDto (bankBin?/No?/Name?/qrImageUrl?), SetRateDto (hourlyRate int≥0), MarkPaidDto (year,month,proofImageUrl,note?), FinalizeDto (year,month), AdjustDto (staffId, workDate ISO, amount int, reason).
- `payroll.controller.ts` (@Roles STAFF,ADMIN, @Controller('staff')): GET /staff/payroll?year=&month=; PUT /staff/bank.
- `admin-payroll.controller.ts` (@Roles ADMIN, @Controller('admin')): GET /admin/payroll?year=&month=; PUT /admin/staff/:userId/rate; POST /admin/payroll/:staffId/finalize; POST /admin/payroll/:staffId/mark-paid; POST /admin/payroll/adjust; POST /admin/payroll/:staffId/recompute.
- `payroll.job.ts`: @Cron 00:30 (dùng CronExpression hoặc '30 0 * * *') recompute current month cho staff có shift/adjustment gần đây. (Đơn giản: recompute tháng hiện tại cho mọi StaffProfile.active.)
- Đăng ký PayrollService + PayrollJob + 2 controller vào StaffModule.

---

### Task 5: FE

- `payroll-api.ts`: getMyPayroll(y,m), updateBank(dto); admin: adminGetPayroll(y,m), setRate(userId,rate), finalize, markPaid, adjust, recompute.
- `my-payroll.tsx` (gate STAFF/ADMIN): chọn tháng; tổng tháng (giờ, gross, phạt, thực nhận, trạng thái, ảnh xác nhận nếu PAID); list ngày; form bank (bin/stk/tên) + upload QR tĩnh.
- `admin.tsx` tab "Lương": chọn tháng; mỗi NV: net + trạng thái + nút "QR" (hiện qrImageUrl) + "Chốt" + "Đã chuyển" (upload ảnh → mark-paid) + set đơn giá.
- Route `/my-payroll`; entry profile "Lương của tôi" (STAFF/ADMIN) + READY.

---

### Task 6: Verify — full api test + repo typecheck + build FE.

## Self-Review
- Spec coverage: §4.2 StaffProfile, §4.5 payroll models, §6.5 tính lương (overlap + fines), §6.6 VietQR, §7 UI lương NV + trả lương admin. Fine đọc từ `session.isLate` (Phase C) + `shift.cancelPenalty` (Phase B) → khớp.
- Idempotent fines theo shiftId+type; không recompute tháng đã chốt/trả.
