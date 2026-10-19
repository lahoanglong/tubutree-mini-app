import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PayrollService } from '../../src/modules/staff/payroll/payroll.service';
import { AttendanceService } from '../../src/modules/staff/attendance/attendance.service';
import { AttendanceController } from '../../src/modules/staff/attendance/attendance.controller';
import { ShiftsService } from '../../src/modules/staff/shifts/shifts.service';
import { AdminShiftsController } from '../../src/modules/staff/admin-shifts.controller';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { vnDateKey } from '../../src/common/vn-time';
import { createUser, sleep, warmPool } from './helpers';

/**
 * Bảng lương: các đường ghi còn lại phải cùng khoá tháng với "Mở lại" / "Chốt" / "Đã chi".
 * Mỗi test dừng một bên ĐÚNG sau lần đọc/ghi cần kiểm (hook tất định), cho bên kia chạy, rồi thả bên bị dừng.
 */
describe('Bảng lương: khoá tháng cho mở lại, chấm công vào ca, duyệt ca (real Postgres)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const config = { get: async (_k: string, d: unknown) => d } as unknown as SystemConfigService;
  const officeConfig = ({
    get: async (k: string, d: unknown) =>
      ({
        'attendance.office_ips': [],
        'attendance.office_lat': 10.7769,
        'attendance.office_lng': 106.7009,
        'attendance.radius_m': 150,
        'attendance.enforce_ip': false,
      })[k] ?? d,
  }) as unknown as SystemConfigService;
  const HERE = { lat: 10.7769, lng: 106.7009 };
  const PROOF = 'https://example.test/proof.png';

  /** Dừng lần gọi `model.method` ĐẦU TIÊN thoả `match` ngay sau khi nó chạy xong (cả trên prisma lẫn tx của $transaction). */
  function holdAfter(
    real: PrismaService,
    model: string,
    method: string,
    match: (args: unknown) => boolean,
    onDone: () => Promise<void>,
  ): PrismaService {
    let fired = false;
    const wrap = (db: object): object =>
      new Proxy(db, {
        get(target, prop) {
          const t = target as Record<string | symbol, unknown>;
          if (prop === model) {
            const delegate = t[model] as Record<string, unknown>;
            return new Proxy(delegate, {
              get(dt, dp) {
                const v = dt[dp as string];
                if (dp === method) {
                  return async (args: unknown) => {
                    const out = await (v as (a: unknown) => Promise<unknown>).call(dt, args);
                    if (!fired && match(args)) {
                      fired = true;
                      await onDone();
                    }
                    return out;
                  };
                }
                return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(dt) : v;
              },
            });
          }
          if (prop === '$transaction') {
            return (cb: unknown, opts?: unknown) =>
              typeof cb === 'function'
                ? (t.$transaction as (...a: unknown[]) => unknown).call(target, (tx: object) => (cb as (x: object) => unknown)(wrap(tx)), opts)
                : (t.$transaction as (...a: unknown[]) => unknown).call(target, cb, opts);
          }
          const v = t[prop];
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
      });
    return wrap(real) as PrismaService;
  }

  /** Nhân viên có hồ sơ lương và một ca APPROVED đang diễn ra hôm nay (giờ VN). */
  async function staffWithLiveShift() {
    const s = await createUser(prisma, { role: 'STAFF' });
    await prisma.staffProfile.create({ data: { userId: s.id, hourlyRate: 30_000 } });
    const now = Date.now();
    const workDate = new Date(`${vnDateKey(new Date(now))}T00:00:00.000Z`);
    const shift = await prisma.shift.create({
      data: { staffId: s.id, workDate, startAt: new Date(now - 10 * 60_000), endAt: new Date(now + 4 * 3_600_000), status: 'APPROVED' },
    });
    return { s, shift, workDate, year: workDate.getUTCFullYear(), month: workDate.getUTCMonth() + 1 };
  }

  const monthRow = (staffId: string, year: number, month: number) =>
    prisma.payrollMonth.findUniqueOrThrow({ where: { staffId_year_month: { staffId, year, month } } });

  const Controller = AttendanceController as unknown as new (...a: unknown[]) => AttendanceController;
  const checkinVia = (db: PrismaService, payroll: PayrollService, staffId: string, shiftId: string) =>
    new Controller(new AttendanceService(db, officeConfig), {} as ConfigService, payroll).checkin(
      staffId,
      { shiftId, ...HERE },
      { ip: '1.1.1.1' } as Request,
    );

  it('"Mở lại" bị dừng ngay sau khi chuyển OPEN, admin khác bấm "Đã chi" → "Mở lại" trả đúng tháng nó vừa mở, không trả tháng PAID', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { s, year, month } = await staffWithLiveShift();
    const svc = new PayrollService(prisma, config);
    await svc.recomputeStaffMonth(s.id, year, month);
    await svc.finalize(s.id, year, month);

    let aDone!: () => void;
    const aWritten = new Promise<void>((r) => (aDone = r));
    let bDone!: () => void;
    const bFinished = new Promise<void>((r) => (bDone = r));
    const hooked = holdAfter(
      prisma,
      'payrollMonth',
      'updateMany',
      (a) => (a as { data?: { status?: string } })?.data?.status === 'OPEN',
      async () => {
        aDone();
        // Bản đã sửa giữ khoá tháng nên "Đã chi" phải chờ: hết 2,5s thì thả.
        await Promise.race([bFinished, sleep(2500)]);
      },
    );
    const reopenRun = new PayrollService(hooked, config).reopen(s.id, year, month, admin.id).then(
      (m) => m.status,
      (e: Error) => `ERR ${e.message}`,
    );
    await aWritten;
    try {
      await svc.markPaid(s.id, year, month, PROOF, undefined, admin.id);
    } finally {
      bDone();
    }
    const reopened = await reopenRun;

    const final = await monthRow(s.id, year, month);
    expect({ reopened, final: final.status, hasProof: final.proofImageUrl !== null }).toEqual({
      reopened: 'OPEN',
      final: 'PAID',
      hasProof: true,
    });
  });

  it('nhân viên check-in bị dừng ngay sau khi đếm phiên cũ, admin bấm "Đã chi" → không có tháng PAID mà vẫn còn phiên mở', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { s, shift, year, month } = await staffWithLiveShift();
    const svc = new PayrollService(prisma, config);
    await svc.recomputeStaffMonth(s.id, year, month);

    let aDone!: () => void;
    const aCounted = new Promise<void>((r) => (aDone = r));
    let bDone!: () => void;
    const bFinished = new Promise<void>((r) => (bDone = r));
    const hooked = holdAfter(prisma, 'attendanceSession', 'count', () => true, async () => {
      aDone();
      await Promise.race([bFinished, sleep(2500)]);
    });
    const checkinRun = checkinVia(hooked, new PayrollService(hooked, config), s.id, shift.id).then(
      () => 'OK',
      (e: Error) => `ERR ${e.message}`,
    );
    await aCounted;
    const paid = await svc.markPaid(s.id, year, month, PROOF, undefined, admin.id).then(
      () => 'OK',
      (e: Error) => `ERR ${e.message}`,
    );
    bDone();
    const checkin = await checkinRun;

    const final = await monthRow(s.id, year, month);
    const open = await prisma.attendanceSession.count({ where: { staffId: s.id, checkoutAt: null } });
    expect({ paidWithOpenSession: final.status === 'PAID' && open > 0, checkin, paid }).toEqual({ paidWithOpenSession: false, checkin, paid });
  });

  it('tháng đã PAID: check-in bị chặn có chữ rõ ràng và không tạo phiên', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { s, shift, year, month } = await staffWithLiveShift();
    const svc = new PayrollService(prisma, config);
    await svc.recomputeStaffMonth(s.id, year, month);
    await svc.markPaid(s.id, year, month, PROOF, undefined, admin.id);

    await expect(checkinVia(prisma, svc, s.id, shift.id)).rejects.toThrow(/đã chốt\/đã trả/);
    expect(await prisma.attendanceSession.count({ where: { staffId: s.id } })).toBe(0);
  });

  it('còn phiên chấm công chưa đóng: "Chốt" và "Đã chi" bị chặn, đóng phiên xong thì chốt được', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { s, shift, year, month } = await staffWithLiveShift();
    const svc = new PayrollService(prisma, config);
    const session = await prisma.attendanceSession.create({
      data: { shiftId: shift.id, staffId: s.id, checkinAt: new Date(Date.now() - 5 * 60_000), checkinLat: 0, checkinLng: 0, checkinIp: '1.1.1.1' },
    });
    await svc.recomputeStaffMonth(s.id, year, month);

    await expect(svc.finalize(s.id, year, month)).rejects.toThrow(/chưa đóng/);
    await expect(svc.markPaid(s.id, year, month, PROOF, undefined, admin.id)).rejects.toThrow(/chưa đóng/);
    expect((await monthRow(s.id, year, month)).status).toBe('OPEN');

    await prisma.attendanceSession.update({ where: { id: session.id }, data: { checkoutAt: new Date(), closeReason: 'MANUAL' } });
    await svc.finalize(s.id, year, month);
    expect((await monthRow(s.id, year, month)).status).toBe('FINALIZED');
  });

  it('tháng đã PAID: admin duyệt ca đang chờ bị chặn, ca vẫn ở trạng thái chờ', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const { s, workDate, year, month } = await staffWithLiveShift();
    const svc = new PayrollService(prisma, config);
    await svc.recomputeStaffMonth(s.id, year, month);
    await svc.markPaid(s.id, year, month, PROOF, undefined, admin.id);
    const pending = await prisma.shift.create({
      data: { staffId: s.id, workDate, startAt: new Date(Date.now() + 5 * 3_600_000), endAt: new Date(Date.now() + 9 * 3_600_000), status: 'PENDING' },
    });

    const Ctl = AdminShiftsController as unknown as new (...a: unknown[]) => AdminShiftsController;
    const ctrl = new Ctl(new ShiftsService(prisma, config), svc);
    await expect(ctrl.approve(admin.id, pending.id, {})).rejects.toThrow(/đã chốt\/đã trả/);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING');
  });
});
