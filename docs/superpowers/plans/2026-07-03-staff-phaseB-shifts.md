# Nhân sự — Phase B: Ca làm (đăng ký + duyệt + copy tuần) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps dùng checkbox.

**Goal:** Nhân viên đăng ký ca theo tuần (chọn ca chuẩn hoặc giờ tuỳ chỉnh), copy ca tuần trước, sửa/xoá ca chờ, huỷ ca đã duyệt theo luật; admin duyệt ca (chỉnh giờ được), từ chối, duyệt hàng loạt.

**Architecture:** Model `ShiftTemplate` + `Shift` (status PENDING→APPROVED/REJECTED/CANCELLED). Logic thuần (overlap, luật huỷ, mốc tuần VN) tách util để TDD. Service `ShiftsService` (self + admin) trong module `staff`. FE trang `/staff` (lưới tuần NV) + mục duyệt ca trong `/admin`. Phạt huỷ trễ chỉ **đánh cờ `cancelPenalty`** (Phase D quy tiền).

**Tech Stack:** NestJS 10, Prisma 5, Jest (mock Prisma). FE ZaUI + react-query. Múi giờ VN (UTC+7) cho mốc ngày/tuần.

## Global Constraints

- `@Roles('STAFF','ADMIN')` cho self endpoints; `@Roles('ADMIN')` cho duyệt. `@CurrentUser('sub')`.
- Ca chồng giờ cùng ngày (cùng staff) → từ chối tạo.
- Chỉ sửa/xoá ca `PENDING`. Duyệt/từ chối chỉ ca `PENDING` (guard updateMany status).
- Huỷ chỉ ca `APPROVED`. Luật: báo trước ≥ `cancel_notice_days` (mặc định 3) → miễn phạt; < 3 ngày → phạt trừ khi đột xuất (có `evidenceUrl`) và số lần đột xuất trong tháng < `emergency_cap_month` (mặc định 3).
- Mốc ngày VN: dùng offset +7 khi tính `workDate`/tuần (không phụ thuộc TZ server). Tuần bắt đầu **Thứ 2**.
- Cấu hình đọc qua `SystemConfigService` (đã có); fallback default nếu thiếu key.
- Lệnh: test `pnpm --filter @tubutree/api test -- <path>`; typecheck `pnpm -w turbo run typecheck`; generate `pnpm --filter @tubutree/api prisma:generate`.
- DB dev không chạy → migration tự viết SQL (áp `prisma migrate deploy` lúc deploy).

## File Structure

- Modify: `apps/api/prisma/schema.prisma` — enum `ShiftStatus`, model `ShiftTemplate`, `Shift`; User thêm `staffShifts`.
- Create: `apps/api/prisma/migrations/20260703030000_staff_phase_b_shifts/migration.sql`.
- Create: `apps/api/src/modules/staff/shifts/time.util.ts` — mốc tuần/ngày VN, overlap.
- Create: `apps/api/src/modules/staff/shifts/time.util.spec.ts`.
- Create: `apps/api/src/modules/staff/shifts/cancel-rule.ts` — quyết định phạt huỷ (thuần).
- Create: `apps/api/src/modules/staff/shifts/cancel-rule.spec.ts`.
- Create: `apps/api/src/modules/staff/shifts/shifts.service.ts` + `.spec.ts`.
- Create: `apps/api/src/modules/staff/shifts/dto/*.ts`.
- Create: `apps/api/src/modules/staff/staff.controller.ts` (self) + mở rộng `admin-staff.controller.ts` hoặc controller riêng `admin-shifts.controller.ts`.
- Modify: `apps/api/src/modules/staff/staff.module.ts` — thêm ShiftsService + controllers.
- Create: `apps/miniapp/src/services/shifts-api.ts`.
- Create: `apps/miniapp/src/pages/staff.tsx` (lưới tuần NV).
- Modify: `apps/miniapp/src/pages/admin.tsx` — thêm mục "Duyệt ca".
- Modify: `apps/miniapp/src/components/app.tsx` — route `/staff`.
- Modify: `apps/miniapp/src/pages/profile.tsx` — entry "Ca làm" cho STAFF/ADMIN.

---

### Task 1: Schema — ShiftTemplate + Shift

- [ ] **Step 1: Thêm enum + models vào schema.prisma** (sau khối RoleGrant)

```prisma
enum ShiftStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

model ShiftTemplate {
  id        String   @id @default(cuid())
  name      String
  startMin  Int // phút từ 00:00, 480 = 08:00
  endMin    Int // 720 = 12:00
  active    Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())

  @@map("shift_templates")
}

model Shift {
  id            String      @id @default(cuid())
  staffId       String
  staff         User        @relation("StaffShifts", fields: [staffId], references: [id], onDelete: Cascade)
  workDate      DateTime    @db.Date
  startAt       DateTime
  endAt         DateTime
  templateId    String?
  status        ShiftStatus @default(PENDING)
  approvedStart DateTime?
  approvedEnd   DateTime?
  approvedBy    String?
  approvedAt    DateTime?
  rejectReason  String?
  cancelReason  String?
  cancelledAt   DateTime?
  isEmergency   Boolean     @default(false)
  evidenceUrl   String?
  cancelPenalty Boolean     @default(false) // Phase D quy ra tiền (1h công)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@index([staffId, workDate])
  @@index([workDate, status])
  @@map("shifts")
}
```

Thêm vào `model User` (khối quan hệ ngược): `staffShifts Shift[] @relation("StaffShifts")`.

- [ ] **Step 2: Migration SQL** — tạo `apps/api/prisma/migrations/20260703030000_staff_phase_b_shifts/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "templateId" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'PENDING',
    "approvedStart" TIMESTAMP(3),
    "approvedEnd" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "evidenceUrl" TEXT,
    "cancelPenalty" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_staffId_workDate_idx" ON "shifts"("staffId", "workDate");
CREATE INDEX "shifts_workDate_status_idx" ON "shifts"("workDate", "status");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3:** `pnpm --filter @tubutree/api prisma:generate` → PASS. Commit.

---

### Task 2: `time.util.ts` (mốc tuần/ngày VN + overlap) — TDD

**Interfaces:**
- `vnDateKey(d: Date): string` — 'YYYY-MM-DD' theo giờ VN.
- `weekStartVN(d: Date): Date` — 00:00 VN Thứ 2 của tuần chứa d (trả Date UTC tương ứng).
- `addDays(d: Date, n: number): Date`.
- `rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean` — giao nhau (biên chạm không tính chồng).

- [ ] **Step 1: test** `time.util.spec.ts`:

```typescript
import { vnDateKey, weekStartVN, addDays, rangesOverlap } from './time.util';

describe('time.util', () => {
  it('vnDateKey theo giờ VN (UTC+7)', () => {
    // 2026-07-03T18:30:00Z = 2026-07-04 01:30 VN
    expect(vnDateKey(new Date('2026-07-03T18:30:00Z'))).toBe('2026-07-04');
    // 2026-07-03T02:00:00Z = 2026-07-03 09:00 VN
    expect(vnDateKey(new Date('2026-07-03T02:00:00Z'))).toBe('2026-07-03');
  });

  it('weekStartVN trả Thứ 2 00:00 VN (2026-07-03 là Thứ 6 → tuần bắt đầu 2026-06-29)', () => {
    const ws = weekStartVN(new Date('2026-07-03T10:00:00Z'));
    expect(vnDateKey(ws)).toBe('2026-06-29');
  });

  it('addDays cộng ngày', () => {
    expect(vnDateKey(addDays(new Date('2026-06-29T00:00:00Z'), 7))).toBe('2026-07-06');
  });

  it('rangesOverlap: chồng nhau', () => {
    expect(rangesOverlap(
      new Date('2026-07-03T01:00:00Z'), new Date('2026-07-03T05:00:00Z'),
      new Date('2026-07-03T04:00:00Z'), new Date('2026-07-03T06:00:00Z'),
    )).toBe(true);
  });

  it('rangesOverlap: biên chạm (a.end == b.start) → không chồng', () => {
    expect(rangesOverlap(
      new Date('2026-07-03T01:00:00Z'), new Date('2026-07-03T04:00:00Z'),
      new Date('2026-07-03T04:00:00Z'), new Date('2026-07-03T06:00:00Z'),
    )).toBe(false);
  });

  it('rangesOverlap: rời nhau → false', () => {
    expect(rangesOverlap(
      new Date('2026-07-03T01:00:00Z'), new Date('2026-07-03T02:00:00Z'),
      new Date('2026-07-03T05:00:00Z'), new Date('2026-07-03T06:00:00Z'),
    )).toBe(false);
  });
});
```

- [ ] **Step 2: chạy → FAIL. Step 3: implement** `time.util.ts`:

```typescript
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' theo giờ VN (UTC+7). */
export function vnDateKey(d: Date): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 VN của Thứ 2 tuần chứa d, trả Date (thời điểm UTC tương ứng). */
export function weekStartVN(d: Date): Date {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const dow = vn.getUTCDay(); // 0=CN..6=T7 (theo giờ VN vì đã shift)
  const daysFromMonday = (dow + 6) % 7; // T2→0, CN→6
  const midnightVN = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - daysFromMonday * 86400000;
  return new Date(midnightVN - VN_OFFSET_MS); // đổi lại về UTC thực
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** Giao thời gian (biên chạm không tính chồng). */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}
```

- [ ] **Step 4: chạy → PASS. Commit.**

---

### Task 3: `cancel-rule.ts` (luật phạt huỷ) — TDD

**Interface:** `decideCancel(input): { allowed: true; penalty: boolean } | { allowed: false; reason: string }`

```typescript
export interface CancelInput {
  now: Date;
  workStart: Date;            // giờ bắt đầu ca (hiệu lực)
  isEmergency: boolean;
  hasEvidence: boolean;
  emergencyCountThisMonth: number; // số ca đột xuất đã huỷ trong tháng (chưa tính ca này)
  noticeDays: number;         // cfg cancel_notice_days
  emergencyCap: number;       // cfg emergency_cap_month
}
```

- [ ] **Step 1: test** `cancel-rule.spec.ts`:

```typescript
import { decideCancel } from './cancel-rule';
const base = {
  now: new Date('2026-07-01T00:00:00Z'),
  workStart: new Date('2026-07-10T01:00:00Z'), // 9 ngày sau
  isEmergency: false, hasEvidence: false,
  emergencyCountThisMonth: 0, noticeDays: 3, emergencyCap: 3,
};

describe('decideCancel', () => {
  it('báo trước ≥3 ngày → miễn phạt', () => {
    expect(decideCancel(base)).toEqual({ allowed: true, penalty: false });
  });
  it('báo <3 ngày, không đột xuất → phạt', () => {
    const r = decideCancel({ ...base, workStart: new Date('2026-07-02T01:00:00Z') });
    expect(r).toEqual({ allowed: true, penalty: true });
  });
  it('báo <3 ngày, đột xuất có chứng cứ, dưới cap → miễn', () => {
    const r = decideCancel({ ...base, workStart: new Date('2026-07-02T01:00:00Z'), isEmergency: true, hasEvidence: true, emergencyCountThisMonth: 2 });
    expect(r).toEqual({ allowed: true, penalty: false });
  });
  it('báo <3 ngày, đột xuất KHÔNG chứng cứ → phạt', () => {
    const r = decideCancel({ ...base, workStart: new Date('2026-07-02T01:00:00Z'), isEmergency: true, hasEvidence: false, emergencyCountThisMonth: 0 });
    expect(r).toEqual({ allowed: true, penalty: true });
  });
  it('báo <3 ngày, đột xuất có chứng cứ nhưng đã đủ cap (3) → phạt', () => {
    const r = decideCancel({ ...base, workStart: new Date('2026-07-02T01:00:00Z'), isEmergency: true, hasEvidence: true, emergencyCountThisMonth: 3 });
    expect(r).toEqual({ allowed: true, penalty: true });
  });
});
```

- [ ] **Step 2: FAIL. Step 3: implement** `cancel-rule.ts`:

```typescript
import type { CancelInput } from './cancel-rule.types'; // hoặc khai báo interface ngay trong file

export function decideCancel(i: CancelInput): { allowed: true; penalty: boolean } {
  const daysNotice = (i.workStart.getTime() - i.now.getTime()) / 86400000;
  if (daysNotice >= i.noticeDays) return { allowed: true, penalty: false };
  // báo trễ
  if (i.isEmergency && i.hasEvidence && i.emergencyCountThisMonth < i.emergencyCap) {
    return { allowed: true, penalty: false };
  }
  return { allowed: true, penalty: true };
}
```

(Khai báo `CancelInput` ngay trong `cancel-rule.ts`, bỏ import types nếu không tách file.)

- [ ] **Step 4: PASS. Commit.**

---

### Task 4: `ShiftsService` (self) — TDD trọng tâm overlap + cancel

**Methods:**
- `listShifts(staffId, from: Date, to: Date)` → shifts trong khoảng.
- `createShifts(staffId, items: {workDate,startAt,endAt,templateId?}[])` → validate overlap (với ca hiện có + trong batch) → tạo PENDING.
- `updateShift(staffId, id, patch)` → chỉ PENDING; re-validate overlap.
- `deleteShift(staffId, id)` → chỉ PENDING.
- `copyWeek(staffId, sourceWeekStart, targetWeekStart)` → clone ca tuần nguồn (mọi status) sang tuần đích thành PENDING (dịch ngày theo offset tuần), bỏ ca trùng.
- `cancelShift(staffId, id, {reason, isEmergency, evidenceUrl})` → chỉ APPROVED; đọc cfg; đếm emergency tháng; `decideCancel` → set CANCELLED + cancelPenalty.

**Test (mock Prisma) — tối thiểu:**
- createShifts từ chối khi trùng ca đã có (findMany trả 1 ca chồng) → BadRequest.
- createShifts từ chối khi 2 item trong batch chồng nhau.
- cancelShift ca không APPROVED → BadRequest.
- cancelShift <3 ngày, không đột xuất → set status CANCELLED + cancelPenalty=true (update gọi đúng).
- cancelShift ≥3 ngày → cancelPenalty=false.
- copyWeek dịch ngày +7 và tạo PENDING (create gọi số lần = số ca nguồn không trùng).

- [ ] Step 1: viết `shifts.service.spec.ts` (mock Prisma pattern như `admin.service.spec.ts`; inject `SystemConfigService` mock trả default noticeDays=3, cap=3). Chi tiết ví dụ:

```typescript
import { BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';

const cfg = { getNumber: jest.fn(async (_k: string, d: number) => d) } as unknown as SystemConfigService;
// (đối chiếu API thực của SystemConfigService: có thể là get(key) trả value; điều chỉnh mock cho khớp)

function makePrisma(over: Record<string, unknown> = {}) {
  const base = { shift: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), count: jest.fn().mockResolvedValue(0) }, $transaction: jest.fn((ops) => Promise.all(ops)) };
  return { ...base, ...over } as unknown as PrismaService;
}

describe('ShiftsService.createShifts', () => {
  it('trùng ca đã có cùng ngày → BadRequest', async () => {
    const prisma = makePrisma({ shift: { findMany: jest.fn().mockResolvedValue([{ startAt: new Date('2026-07-10T01:00:00Z'), endAt: new Date('2026-07-10T05:00:00Z') }]), create: jest.fn() } });
    const svc = new ShiftsService(prisma, cfg);
    await expect(svc.createShifts('u1', [{ workDate: new Date('2026-07-10'), startAt: new Date('2026-07-10T04:00:00Z'), endAt: new Date('2026-07-10T06:00:00Z') }]))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
```

> **Xác nhận API `SystemConfigService`** trước khi viết (mở `system-config.service.ts`): tên method đọc value + kiểu trả. Điều chỉnh mock + gọi trong service cho khớp (VD `get<T>(key)` hay `getNumber(key, default)`).

- [ ] Step 2–4: implement `shifts.service.ts` cho tới khi test PASS; commit.

**Bản phác implementation (điều chỉnh theo API config thực tế):**

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { rangesOverlap, vnDateKey } from './time.util';
import { decideCancel } from './cancel-rule';

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService, private readonly config: SystemConfigService) {}

  listShifts(staffId: string, from: Date, to: Date) {
    return this.prisma.shift.findMany({
      where: { staffId, workDate: { gte: from, lte: to } },
      orderBy: [{ workDate: 'asc' }, { startAt: 'asc' }],
    });
  }

  async createShifts(staffId: string, items: { workDate: Date; startAt: Date; endAt: Date; templateId?: string }[]) {
    for (const it of items) if (it.endAt <= it.startAt) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu.');
    // chồng trong batch
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (rangesOverlap(items[i].startAt, items[i].endAt, items[j].startAt, items[j].endAt))
          throw new BadRequestException('Các ca đăng ký bị chồng giờ nhau.');
    // chồng với ca đã có (không tính ca CANCELLED/REJECTED)
    const dates = items.map((i) => i.workDate);
    const existing = await this.prisma.shift.findMany({
      where: { staffId, workDate: { in: dates }, status: { in: ['PENDING', 'APPROVED'] } },
      select: { startAt: true, endAt: true },
    });
    for (const it of items)
      for (const ex of existing)
        if (rangesOverlap(it.startAt, it.endAt, ex.startAt, ex.endAt))
          throw new BadRequestException('Ca bị chồng với ca đã đăng ký.');
    await this.prisma.$transaction(
      items.map((it) => this.prisma.shift.create({ data: { staffId, workDate: it.workDate, startAt: it.startAt, endAt: it.endAt, templateId: it.templateId } })),
    );
    return { created: items.length };
  }

  async updateShift(staffId: string, id: string, patch: { startAt?: Date; endAt?: Date }) {
    const shift = await this.prisma.shift.findFirst({ where: { id, staffId } });
    if (!shift) throw new NotFoundException('Không tìm thấy ca.');
    if (shift.status !== 'PENDING') throw new BadRequestException('Chỉ sửa được ca đang chờ duyệt.');
    const startAt = patch.startAt ?? shift.startAt;
    const endAt = patch.endAt ?? shift.endAt;
    if (endAt <= startAt) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu.');
    const others = await this.prisma.shift.findMany({ where: { staffId, workDate: shift.workDate, status: { in: ['PENDING', 'APPROVED'] }, id: { not: id } }, select: { startAt: true, endAt: true } });
    for (const ex of others) if (rangesOverlap(startAt, endAt, ex.startAt, ex.endAt)) throw new BadRequestException('Ca bị chồng giờ.');
    return this.prisma.shift.update({ where: { id }, data: { startAt, endAt } });
  }

  async deleteShift(staffId: string, id: string) {
    const del = await this.prisma.shift.deleteMany({ where: { id, staffId, status: 'PENDING' } });
    if (del.count === 0) throw new BadRequestException('Chỉ xoá được ca đang chờ duyệt.');
    return { deleted: true };
  }

  async copyWeek(staffId: string, sourceWeekStart: Date, targetWeekStart: Date) {
    const offset = targetWeekStart.getTime() - sourceWeekStart.getTime();
    const src = await this.prisma.shift.findMany({
      where: { staffId, workDate: { gte: sourceWeekStart, lt: new Date(sourceWeekStart.getTime() + 7 * 86400000) } },
    });
    const existing = await this.prisma.shift.findMany({
      where: { staffId, workDate: { gte: targetWeekStart, lt: new Date(targetWeekStart.getTime() + 7 * 86400000) }, status: { in: ['PENDING', 'APPROVED'] } },
      select: { startAt: true, endAt: true },
    });
    const toCreate = src
      .map((s) => ({ workDate: new Date(s.workDate.getTime() + offset), startAt: new Date(s.startAt.getTime() + offset), endAt: new Date(s.endAt.getTime() + offset), templateId: s.templateId ?? undefined }))
      .filter((c) => !existing.some((ex) => rangesOverlap(c.startAt, c.endAt, ex.startAt, ex.endAt)));
    if (toCreate.length) await this.prisma.$transaction(toCreate.map((c) => this.prisma.shift.create({ data: { staffId, ...c } })));
    return { created: toCreate.length, skipped: src.length - toCreate.length };
  }

  async cancelShift(staffId: string, id: string, body: { reason: string; isEmergency?: boolean; evidenceUrl?: string }) {
    const shift = await this.prisma.shift.findFirst({ where: { id, staffId } });
    if (!shift) throw new NotFoundException('Không tìm thấy ca.');
    if (shift.status !== 'APPROVED') throw new BadRequestException('Chỉ huỷ được ca đã duyệt.');
    const noticeDays = await this.config.getNumber('attendance.cancel_notice_days', 3);
    const cap = await this.config.getNumber('attendance.emergency_cap_month', 3);
    const workStart = shift.approvedStart ?? shift.startAt;
    // đếm ca đột xuất đã huỷ trong tháng (theo workDate VN)
    const monthStart = new Date(Date.UTC(shift.workDate.getUTCFullYear(), shift.workDate.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(shift.workDate.getUTCFullYear(), shift.workDate.getUTCMonth() + 1, 1));
    const emergencyCount = await this.prisma.shift.count({
      where: { staffId, status: 'CANCELLED', isEmergency: true, cancelPenalty: false, workDate: { gte: monthStart, lt: monthEnd } },
    });
    const decision = decideCancel({ now: new Date(), workStart, isEmergency: !!body.isEmergency, hasEvidence: !!body.evidenceUrl, emergencyCountThisMonth: emergencyCount, noticeDays, emergencyCap: cap });
    const updated = await this.prisma.shift.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'CANCELLED', cancelReason: body.reason, isEmergency: !!body.isEmergency, evidenceUrl: body.evidenceUrl, cancelledAt: new Date(), cancelPenalty: decision.penalty },
    });
    if (updated.count === 0) throw new BadRequestException('Ca đã đổi trạng thái, thử lại.');
    return { cancelled: true, penalty: decision.penalty };
  }
}
```

> Nếu `SystemConfigService` không có `getNumber`, thay bằng API thực (VD `const v = await this.config.get<number>('...')  ?? 3`). Điều chỉnh cả mock test.

---

### Task 5: Admin shift service methods + templates

Thêm vào `ShiftsService` (hoặc `AdminShiftsService`):
- `listAll(from, to, staffId?)` — ca mọi NV (join user tên).
- `approve(adminId, id, {approvedStart?, approvedEnd?})` — guard status PENDING → APPROVED, set approvedBy/At.
- `reject(adminId, id, reason)` — PENDING → REJECTED.
- `bulkApprove(adminId, ids[])`.
- Templates CRUD: `listTemplates/createTemplate/updateTemplate/deleteTemplate`.

Test: approve ca không PENDING → BadRequest (updateMany count 0); approve set approvedStart khi truyền.

```typescript
  async approve(adminId: string, id: string, times?: { approvedStart?: Date; approvedEnd?: Date }) {
    const r = await this.prisma.shift.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', approvedBy: adminId, approvedAt: new Date(), approvedStart: times?.approvedStart ?? null, approvedEnd: times?.approvedEnd ?? null },
    });
    if (r.count === 0) throw new BadRequestException('Ca không ở trạng thái chờ duyệt.');
    return { approved: true };
  }
  async reject(adminId: string, id: string, reason: string) {
    const r = await this.prisma.shift.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', rejectReason: reason, approvedBy: adminId, approvedAt: new Date() } });
    if (r.count === 0) throw new BadRequestException('Ca không ở trạng thái chờ duyệt.');
    return { rejected: true };
  }
  async bulkApprove(adminId: string, ids: string[]) {
    const r = await this.prisma.shift.updateMany({ where: { id: { in: ids }, status: 'PENDING' }, data: { status: 'APPROVED', approvedBy: adminId, approvedAt: new Date() } });
    return { approved: r.count };
  }
```

---

### Task 6: DTO + controllers

- `staff.controller.ts` (`@Roles('STAFF','ADMIN')`, `@Controller('staff')`): GET `/staff/shifts`, POST `/staff/shifts`, PATCH `/staff/shifts/:id`, DELETE `/staff/shifts/:id`, POST `/staff/shifts/copy-week`, POST `/staff/shifts/:id/cancel`, GET `/staff/shift-templates` (đọc để render lưới).
- `admin-shifts.controller.ts` (`@Roles('ADMIN')`, `@Controller('admin')`): GET `/admin/shifts`, POST `/admin/shifts/:id/approve`, POST `/admin/shifts/:id/reject`, POST `/admin/shifts/bulk-approve`, CRUD `/admin/shift-templates`.
- DTO với class-validator: `CreateShiftsDto { items: ShiftItemDto[] }` (dùng `@ValidateNested`, `@Type`), `ShiftItemDto { workDate: ISO, startAt, endAt, templateId? }` (`@IsDateString`), `CopyWeekDto { sourceWeekStart, targetWeekStart }`, `CancelShiftDto { reason, isEmergency?, evidenceUrl? }`, `ApproveShiftDto { approvedStart?, approvedEnd? }`, `RejectShiftDto { reason }`, `TemplateDto { name, startMin, endMin, active?, sortOrder? }`.
- Controller chuyển ISO string → `new Date(...)` trước khi gọi service.
- Đăng ký controllers + `ShiftsService` trong `staff.module.ts` (import `SystemConfigModule` nếu SystemConfigService không global — kiểm tra).

Verify: `pnpm --filter @tubutree/api exec tsc -p tsconfig.json --noEmit` + full test.

---

### Task 7: FE — `shifts-api.ts` + trang `/staff` (lưới tuần) + duyệt ca trong `/admin`

- `shifts-api.ts`: types Shift/Template + hàm getShifts(from,to), createShifts(items), updateShift, deleteShift, copyWeek, cancelShift, getTemplates; admin: getAllShifts, approveShift, rejectShift, bulkApprove, template CRUD.
- `staff.tsx` (gate STAFF/ADMIN): 
  - Thanh chuyển tuần ‹ Tuần dd/mm – dd/mm ›.
  - Lưới 7 ngày (cột), mỗi ngày liệt kê ca + badge trạng thái (màu: chờ=cam đất, duyệt=lá, từ chối/huỷ=xám).
  - FAB/nút "＋ Thêm ca" → Sheet: chọn ngày + chọn ShiftTemplate (chip) hoặc giờ tuỳ chỉnh (2 Input time) → thêm vào danh sách nháp → "Gửi duyệt" (createShifts).
  - Nút "Copy tuần trước" → copyWeek(prevWeekStart, currentWeekStart) → toast số ca copy.
  - Ca PENDING: nút sửa/xoá. Ca APPROVED: nút "Huỷ ca" → Sheet lý do + toggle "đột xuất" + ImageUpload chứng cứ.
- `admin.tsx`: thêm tab/section "Duyệt ca" — lưới tuần toàn NV, mỗi ca PENDING có nút Duyệt (mở sheet chỉnh giờ optional) / Từ chối; nút "Duyệt tất cả" (bulkApprove các id PENDING trong tuần); quản lý ShiftTemplate (CRUD gọn).
- Route `/staff` trong app.tsx (lazy). Entry profile: thêm mục "Ca làm & chấm công" `to:/staff` cho STAFF/ADMIN + thêm `/staff` vào READY.

Verify FE: `pnpm --filter @tubutree/miniapp exec tsc --noEmit` + `build`.

---

### Task 8: Verify Phase B

- `pnpm --filter @tubutree/api test` → all PASS.
- `pnpm -w turbo run typecheck` → PASS.
- Kiểm thử thủ công (khi có DB): tạo template; NV thêm ca tuần, gửi duyệt; copy tuần trước; admin duyệt chỉnh giờ; NV huỷ ca <3 ngày → cancelPenalty=true; ≥3 ngày → false.

## Self-Review

- **Spec coverage:** §4.3 (ShiftTemplate/Shift), §6.1 self+admin shift endpoints, §6.4 luật huỷ (đánh cờ, tiền để Phase D), §7.1 lưới tuần + copy tuần + huỷ, §7.2 duyệt ca chỉnh giờ + bulk — có task. Giờ công/lương = Phase C/D.
- **Placeholder scan:** code thật cho schema/util/rule/service; các "> Xác nhận" là đối chiếu API config/ZaUI thực tế (không phải logic thiếu).
- **Type consistency:** `decideCancel` trả `{allowed, penalty}`; service set `cancelPenalty=decision.penalty`; Phase D đọc `Shift.cancelPenalty`. `weekStartVN` dùng chung FE/BE (FE tự tính tuần để gọi copy-week & query).
