import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PANCAKE_PUSH, PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import { PancakeApiError } from '../../src/modules/integrations/pancake/pancake-outbound';
import { GameEconomyService } from '../../src/modules/game/game-economy.service';
import { PayrollService } from '../../src/modules/staff/payroll/payroll.service';
import { AttendanceService } from '../../src/modules/staff/attendance/attendance.service';
import { AdminAttendanceController } from '../../src/modules/staff/attendance/admin-attendance.controller';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import type { SeasonPassService } from '../../src/modules/game/season-pass.service';
import type { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { createOrder, createUser, randCode, sleep, warmPool } from './helpers';

/**
 * UAT D4-01/02/03 trên Postgres thật: ba chỗ "đọc rồi ghi đè theo lần đọc cũ".
 * Mỗi test dừng một bên ĐÚNG sau lần đọc cũ (hook tất định), cho bên kia chạy xong, rồi thả bên bị dừng.
 */
describe('UAT race p3 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  describe('D4-01 đẩy Pancake: quyết định tra đơn trước khi tạo dựa trên DB lúc claim', () => {
    const queue = { name: 'pancake-push', getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({}) };
    const client = {
      isConfigured: jest.fn().mockReturnValue(true),
      createOrder: jest.fn(),
      searchOrders: jest.fn(),
      resolveOrderTags: jest.fn().mockResolvedValue([]),
      getOrder: jest.fn(),
      updateOrder: jest.fn(),
    };

    const tubuVariationId = async () => {
      const tag = randCode(8);
      const product = await prisma.product.create({
        data: { pancakeId: `itp3-p-${tag}`, fulfilment: 'TUBU', brand: 'IT', slug: `itp3-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
      });
      const v = await prisma.variation.create({
        data: { pancakeId: `itp3-v-${tag}`, productId: product.id, sku: `ITP3-${tag}`, name: '1kg', attributes: {}, retailPrice: 100_000, stock: 20 },
      });
      return v.id;
    };

    it('B đọc đơn trước khi A claim; A tạo đơn Pancake rồi gặp lỗi tạm; B claim sau → phải tra đơn và nhận, không tạo thêm', async () => {
      const buyer = await createUser(prisma);
      const o = await createOrder(prisma, {
        userId: buyer.id,
        total: 130_000,
        subtotal: 100_000,
        shippingFee: 30_000,
        items: {
          create: [{ variationId: await tubuVariationId(), productName: 'SP IT', variationName: '1kg', unitPrice: 100_000, quantity: 1, total: 100_000 }],
        },
      });
      const pkId = `pk-${randCode(8)}`;
      let existsOnPancake = false;
      client.createOrder.mockReset().mockImplementation(async () => {
        existsOnPancake = true; // Pancake đã tạo đơn nhưng phản hồi không về tới Tubu
        throw new PancakeApiError('read ECONNRESET', true);
      });
      client.searchOrders.mockReset().mockImplementation(async () => (existsOnPancake ? [{ id: pkId, status: 0, custom_id: o.code }] : []));

      const a = new PancakeOrderService(prisma, client as unknown as PancakeClient, queue as never);
      const b = new PancakeOrderService(prisma, client as unknown as PancakeClient, queue as never);
      let release!: () => void;
      const aDone = new Promise<void>((r) => (release = r));
      const realVariationsOf = (b as unknown as { variationsOf: (x: unknown) => Promise<unknown> }).variationsOf.bind(b);
      let hooked = false;
      let bReadOrder!: () => void;
      const bRead = new Promise<void>((r) => (bReadOrder = r));
      jest.spyOn(b as never, 'variationsOf').mockImplementation((async (order: unknown) => {
        if (!hooked) {
          hooked = true;
          bReadOrder();
          await aDone;
        }
        return realVariationsOf(order);
      }) as never);

      const bRun = b.pushOrder(o.id);
      await bRead;
      await expect(a.pushOrder(o.id)).rejects.toThrow('ECONNRESET');
      release();
      const bResult = await bRun;

      expect(client.createOrder).toHaveBeenCalledTimes(1);
      expect(bResult).toBe(pkId);
      const saved = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(saved).toMatchObject({ pancakeOrderId: pkId, pancakePushStatus: PANCAKE_PUSH.SYNCED });
    });
  });

  describe('D4-02 điểm danh Vườn Xanh không ghi đè vé giữ lửa / chuỗi hồi sinh', () => {
    const seasonPass = { addXp: jest.fn().mockResolvedValue(undefined) } as unknown as SeasonPassService;
    const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
    const plainConfig = { get: async (_k: string, d: unknown) => d } as unknown as SystemConfigService;
    const dayMs = 86_400_000;

    /** checkIn dừng ngay sau lần đọc hồ sơ (lần config.get đầu tiên) cho tới khi `until` xong. */
    function pausedCheckIn(until: Promise<unknown>) {
      let paused = false;
      let reached!: () => void;
      const atRead = new Promise<void>((r) => (reached = r));
      const cfg = {
        get: async (k: string, d: unknown) => {
          if (!paused && k === 'game.daily_login_seeds') {
            paused = true;
            reached();
            await until;
          }
          return d;
        },
      } as unknown as SystemConfigService;
      return { svc: new GameEconomyService(prisma, cfg, seasonPass, analytics), atRead };
    }

    it('(a) mua vé giữ lửa lúc điểm danh đang chạy → vé vẫn còn, nước trừ đúng một lần', async () => {
      const u = await createUser(prisma);
      await prisma.gameProfile.create({
        data: { userId: u.id, streakDays: 5, totalSeeds: 300, streakFreezes: 0, lastCheckInAt: new Date(Date.now() - dayMs) },
      });
      let bDone!: () => void;
      const bFinished = new Promise<void>((r) => (bDone = r));
      const a = pausedCheckIn(bFinished);
      const checkIn = a.svc.checkIn(u.id);
      await a.atRead;
      await new GameEconomyService(prisma, plainConfig, seasonPass, analytics).buyStreakFreeze(u.id);
      bDone();
      await checkIn;

      const after = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: u.id } });
      expect(after.streakFreezes).toBe(1);
      expect(after.streakDays).toBe(6);
      expect(after.totalSeeds).toBe(300 - 80 + 10 + 5);
    });

    it('(b) hồi sinh chuỗi lúc điểm danh đang chạy → chuỗi = chuỗi đã hồi sinh + 1, không tụt về 2', async () => {
      const u = await createUser(prisma);
      await prisma.gameProfile.create({
        data: {
          userId: u.id,
          streakDays: 1,
          totalSeeds: 300,
          brokenStreakDays: 10,
          brokenStreakAt: new Date(Date.now() - 3_600_000),
          lastCheckInAt: new Date(Date.now() - dayMs),
        },
      });
      let bDone!: () => void;
      const bFinished = new Promise<void>((r) => (bDone = r));
      const a = pausedCheckIn(bFinished);
      const checkIn = a.svc.checkIn(u.id);
      await a.atRead;
      await new GameEconomyService(prisma, plainConfig, seasonPass, analytics).repairStreak(u.id);
      bDone();
      await checkIn;

      const after = await prisma.gameProfile.findUniqueOrThrow({ where: { userId: u.id } });
      expect(after.streakDays).toBe(12);
      expect(after.brokenStreakAt).toBeNull();
      expect(after.totalSeeds).toBe(300 - 150 + 10 + 5);
    });
  });

  describe('D4-03 bảng lương: recompute tồn đọng không ghi đè tháng đã PAID', () => {
    const config = { get: async (_k: string, d: unknown) => d } as unknown as SystemConfigService;

    /**
     * Bọc prisma (và tx của $transaction) sao cho lần gọi `model.method` ĐẦU TIÊN thoả `match` dừng lại sau khi đọc xong,
     * chạy `onRead` (có thể chờ) rồi mới trả kết quả cho bên gọi.
     */
    function holdAfterRead(
      real: PrismaService,
      model: string,
      method: string,
      match: (args: unknown) => boolean,
      onRead: () => Promise<void>,
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
                        await onRead();
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

    const holdAfterAdjustmentRead = (real: PrismaService, onRead: () => Promise<void>) =>
      holdAfterRead(real, 'payrollAdjustment', 'findMany', (a) => Boolean((a as { select?: { amount?: boolean } })?.select?.amount), onRead);
    const holdAfterMonthCheck = (real: PrismaService, onRead: () => Promise<void>) =>
      holdAfterRead(real, 'payrollMonth', 'findUnique', () => true, onRead);

    async function staffWithApprovedDay(day: Date) {
      const s = await createUser(prisma, { role: 'STAFF' });
      await prisma.staffProfile.create({ data: { userId: s.id, hourlyRate: 30_000 } });
      const iso = (h: number) => new Date(`${day.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:00:00.000Z`);
      const shift = await prisma.shift.create({
        data: { staffId: s.id, workDate: day, startAt: iso(1), endAt: iso(9), status: 'APPROVED' },
      });
      const session = await prisma.attendanceSession.create({
        data: { shiftId: shift.id, staffId: s.id, checkinAt: iso(1), checkoutAt: iso(9), checkinLat: 0, checkinLng: 0, checkinIp: '1.1.1.1' },
      });
      return { s, shift, session, iso };
    }

    it('nhân viên mở "Lương của tôi" (đọc cũ) trong lúc admin trừ 100.000đ rồi bấm "Đã chi" → tháng PAID giữ net đã chi', async () => {
      const s = await createUser(prisma, { role: 'STAFF' });
      const admin = await createUser(prisma, { role: 'ADMIN' });
      await prisma.staffProfile.create({ data: { userId: s.id, hourlyRate: 30_000 } });
      const day = new Date('2026-07-10T00:00:00.000Z');
      const shift = await prisma.shift.create({
        data: { staffId: s.id, workDate: day, startAt: new Date('2026-07-10T01:00:00.000Z'), endAt: new Date('2026-07-10T09:00:00.000Z'), status: 'APPROVED' },
      });
      await prisma.attendanceSession.create({
        data: {
          shiftId: shift.id,
          staffId: s.id,
          checkinAt: new Date('2026-07-10T01:00:00.000Z'),
          checkoutAt: new Date('2026-07-10T09:00:00.000Z'),
          checkinLat: 0,
          checkinLng: 0,
          checkinIp: '1.1.1.1',
        },
      });
      const adminSvc = new PayrollService(prisma, config);
      expect((await adminSvc.recomputeStaffMonth(s.id, 2026, 7)).net).toBe(240_000);

      let aRead!: () => void;
      const aReadDone = new Promise<void>((r) => (aRead = r));
      let bDone!: () => void;
      const bFinished = new Promise<void>((r) => (bDone = r));
      const hooked = holdAfterAdjustmentRead(prisma, async () => {
        aRead();
        // Bản đã sửa giữ khoá tháng nên bên admin phải chờ: hết 2,5s thì thả.
        await Promise.race([bFinished, sleep(2500)]);
      });
      const staffSide = new PayrollService(hooked, config).recomputeStaffMonth(s.id, 2026, 7);
      await aReadDone;
      const adminSide = (async () => {
        try {
          await adminSvc.adjust(s.id, day, 100_000, 'phạt thử', admin.id);
          await adminSvc.markPaid(s.id, 2026, 7, 'https://example.test/proof.png', undefined, admin.id);
        } finally {
          bDone();
        }
      })();
      await Promise.all([staffSide, adminSide]);

      const month = await prisma.payrollMonth.findUniqueOrThrow({ where: { staffId_year_month: { staffId: s.id, year: 2026, month: 7 } } });
      const dayRow = await prisma.payrollDay.findUniqueOrThrow({ where: { staffId_workDate: { staffId: s.id, workDate: day } } });
      expect(month.status).toBe('PAID');
      expect(month.net).toBe(140_000);
      expect(month.totalFines).toBe(100_000);
      expect(dayRow.net).toBe(140_000);
    });

    /**
     * Các đường GHI dữ liệu đầu vào của tháng (khoản điều chỉnh, phiên chấm công) phải kiểm khoá tháng và ghi trong
     * CÙNG khoá với markPaid. Bất biến kiểm: net đã chi khớp dữ liệu đầu vào còn lại trong DB (không có khoản mồ côi).
     */
    it('admin A trừ 100.000đ bị dừng ngay sau lần kiểm tháng, admin B bấm "Đã chi" → net PAID khớp các khoản điều chỉnh trong DB', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN' });
      const day = new Date('2026-08-10T00:00:00.000Z');
      const { s } = await staffWithApprovedDay(day);
      const svc = new PayrollService(prisma, config);
      expect((await svc.recomputeStaffMonth(s.id, 2026, 8)).net).toBe(240_000);

      let aRead!: () => void;
      const aReadDone = new Promise<void>((r) => (aRead = r));
      let bDone!: () => void;
      const bFinished = new Promise<void>((r) => (bDone = r));
      const hooked = holdAfterMonthCheck(prisma, async () => {
        aRead();
        await Promise.race([bFinished, sleep(2500)]);
      });
      const adjustRun = new PayrollService(hooked, config).adjust(s.id, day, 100_000, 'phạt thử', admin.id).then(
        () => 'OK',
        (e: Error) => `ERR ${e.message}`,
      );
      await aReadDone;
      try {
        await svc.markPaid(s.id, 2026, 8, 'https://example.test/proof.png', undefined, admin.id);
      } finally {
        bDone();
      }
      const adjustResult = await adjustRun;

      const month = await prisma.payrollMonth.findUniqueOrThrow({ where: { staffId_year_month: { staffId: s.id, year: 2026, month: 8 } } });
      const manual = await prisma.payrollAdjustment.findMany({ where: { staffId: s.id, type: 'MANUAL' } });
      const deducted = manual.reduce((sum, a) => sum + a.amount, 0);
      expect({ status: month.status, net: month.net, adjustResult }).toEqual({
        status: 'PAID',
        net: 240_000 - deducted,
        adjustResult,
      });
      if (adjustResult !== 'OK') expect(manual).toHaveLength(0);
    });

    it('admin A sửa giờ ra phiên (còn 4 giờ) bị dừng ngay sau lần kiểm tháng, admin B bấm "Đã chi" → net PAID khớp giờ của phiên trong DB', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN' });
      const day = new Date('2026-09-10T00:00:00.000Z');
      const { s, session, iso } = await staffWithApprovedDay(day);
      const svc = new PayrollService(prisma, config);
      expect((await svc.recomputeStaffMonth(s.id, 2026, 9)).net).toBe(240_000);

      let aRead!: () => void;
      const aReadDone = new Promise<void>((r) => (aRead = r));
      let bDone!: () => void;
      const bFinished = new Promise<void>((r) => (bDone = r));
      const hooked = holdAfterMonthCheck(prisma, async () => {
        aRead();
        await Promise.race([bFinished, sleep(2500)]);
      });
      const ctrl = new AdminAttendanceController(new AttendanceService(hooked, config), new PayrollService(hooked, config));
      const editRun = ctrl.editSession(session.id, { checkoutAt: iso(5).toISOString() }).then(
        () => 'OK',
        (e: Error) => `ERR ${e.message}`,
      );
      await aReadDone;
      try {
        await svc.markPaid(s.id, 2026, 9, 'https://example.test/proof.png', undefined, admin.id);
      } finally {
        bDone();
      }
      const editResult = await editRun;

      const month = await prisma.payrollMonth.findUniqueOrThrow({ where: { staffId_year_month: { staffId: s.id, year: 2026, month: 9 } } });
      const saved = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: session.id } });
      const hours = ((saved.checkoutAt as Date).getTime() - saved.checkinAt.getTime()) / 3_600_000;
      expect({ status: month.status, net: month.net, editResult }).toEqual({ status: 'PAID', net: hours * 30_000, editResult });
    });
  });
});
