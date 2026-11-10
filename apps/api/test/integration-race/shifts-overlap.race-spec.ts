import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ShiftsService } from '../../src/modules/staff/shifts/shifts.service';
import { rangesOverlap } from '../../src/modules/staff/shifts/time.util';
import { createUser, deleteItData, summarize, warmPool } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Thứ Hai 03/03/2031: xa tương lai, mỗi ca test dùng nhân viên riêng nên không đụng dữ liệu nào khác.
const BASE = Date.UTC(2031, 2, 3);
const slot = (day: number, from: number, to: number) => ({
  workDate: new Date(BASE + day * DAY),
  startAt: new Date(BASE + day * DAY + from * HOUR),
  endAt: new Date(BASE + day * DAY + to * HOUR),
});
const ROUNDS = 4;

/**
 * Ca làm của một nhân viên không được chồng giờ (createShifts cố tình cấm). createShifts / updateShift / copyWeek đọc ca đang có rồi
 * mới ghi ở lệnh khác nên hai yêu cầu song song cùng nhân viên cùng lọt qua bước kiểm, để lại hai ca chồng giờ (giờ công tính hai lần).
 */
describe('ShiftsService — ca chồng giờ khi hai yêu cầu song song cùng nhân viên (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: ShiftsService;
  const userIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = new ShiftsService(prisma, { get: async (_k: string, d: number) => d } as never);
  });

  afterAll(async () => {
    await prisma.shift.deleteMany({ where: { staffId: { in: userIds } } });
    await deleteItData(prisma, { userIds });
    await moduleRef?.close();
  });

  const newStaff = async () => {
    const u = await createUser(prisma, { role: 'STAFF' });
    userIds.push(u.id);
    return u.id;
  };

  /** Mọi ca PENDING/APPROVED của nhân viên, kèm khẳng định không cặp nào chồng nhau (biên chạm không tính, như rangesOverlap). */
  const liveShifts = async (staffId: string) => {
    const rows = await prisma.shift.findMany({
      where: { staffId, status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: { startAt: 'asc' },
    });
    const clashes: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;
        if (rangesOverlap(a.startAt, a.endAt, b.startAt, b.endAt)) {
          clashes.push(`${a.startAt.toISOString()}..${a.endAt.toISOString()} x ${b.startAt.toISOString()}..${b.endAt.toISOString()}`);
        }
      }
    }
    expect(clashes).toEqual([]);
    return rows;
  };

  const expectOverlapRejection = (errors: PromiseRejectedResult[]) => {
    for (const r of errors) {
      expect(r.reason).toBeInstanceOf(BadRequestException);
      expect((r.reason as BadRequestException).message).toMatch(/chồng/);
    }
  };

  it('(a) 8 lần đăng ký song song cùng một khung giờ: đúng 1 thắng, 7 bị báo chồng, chỉ 1 ca trong DB', async () => {
    const staffId = await newStaff();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => svc.createShifts(staffId, [slot(0, 9, 12)])));
    const s = summarize(results);
    expect({ fulfilled: s.fulfilled.length, errors: s.errors }).toEqual({
      fulfilled: 1,
      errors: Array.from({ length: 7 }, () => 'BadRequestException: Ca bị chồng với ca đã đăng ký.'),
    });
    expectOverlapRejection(s.rejected);
    expect(await liveShifts(staffId)).toHaveLength(1);
  });

  it('(b) hai lần đăng ký song song chồng một phần (09:00-12:00 và 11:00-14:00): đúng 1 thắng, không ca nào chồng', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const staffId = await newStaff();
      const results = await Promise.allSettled([
        svc.createShifts(staffId, [slot(0, 9, 12)]),
        svc.createShifts(staffId, [slot(0, 11, 14)]),
      ]);
      const s = summarize(results);
      expect({ round, fulfilled: s.fulfilled.length, errors: s.errors }).toEqual({
        round,
        fulfilled: 1,
        errors: ['BadRequestException: Ca bị chồng với ca đã đăng ký.'],
      });
      expect(await liveShifts(staffId)).toHaveLength(1);
    }
  });

  it('(c) đăng ký khung X song song với sửa một ca PENDING sang khung X: không bao giờ có hai ca chồng nhau', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const staffId = await newStaff();
      const existing = await prisma.shift.create({ data: { staffId, ...slot(0, 15, 16) } });
      const moved = slot(0, 10, 13);
      const results = await Promise.allSettled([
        svc.createShifts(staffId, [slot(0, 9, 12)]),
        svc.updateShift(staffId, existing.id, { startAt: moved.startAt, endAt: moved.endAt }),
      ]);
      const s = summarize(results);
      expect({ round, fulfilled: s.fulfilled.length, errors: s.errors }).toMatchObject({ round, fulfilled: 1 });
      expectOverlapRejection(s.rejected);
      // createShifts thắng: ca mới + ca cũ giữ 15:00-16:00 (2 ca). updateShift thắng: ca cũ dời sang khung X và createShifts bị từ chối (1 ca).
      const createWon = results[0].status === 'fulfilled';
      expect({ round, rows: (await liveShifts(staffId)).length }).toEqual({ round, rows: createWon ? 2 : 1 });
    }
  });

  it('(d) 6 lần đăng ký song song các khung KHÁC NHAU không chồng (kể cả chạm biên) của cùng nhân viên: cả 6 thắng', async () => {
    const staffId = await newStaff();
    const results = await Promise.allSettled(
      [8, 9, 10, 11, 12, 13].map((h) => svc.createShifts(staffId, [slot(0, h, h + 1)])),
    );
    const s = summarize(results);
    expect({ fulfilled: s.fulfilled.length, errors: s.errors }).toEqual({ fulfilled: 6, errors: [] });
    expect(await liveShifts(staffId)).toHaveLength(6);
  });

  it('(e) 5 nhân viên khác nhau đăng ký cùng khung giờ song song: cả 5 thắng (khoá theo từng nhân viên)', async () => {
    const staffIds = await Promise.all(Array.from({ length: 5 }, () => newStaff()));
    const results = await Promise.allSettled(staffIds.map((id) => svc.createShifts(id, [slot(0, 9, 12)])));
    const s = summarize(results);
    expect({ fulfilled: s.fulfilled.length, errors: s.errors }).toEqual({ fulfilled: 5, errors: [] });
    for (const id of staffIds) expect(await liveShifts(id)).toHaveLength(1);
  });

  it('(f) đăng ký ca tuần đích song song với "Copy tuần trước" vào đúng tuần đó: không bao giờ có hai ca chồng nhau', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const staffId = await newStaff();
      await prisma.shift.createMany({ data: [{ staffId, ...slot(0, 9, 12) }, { staffId, ...slot(1, 9, 12) }] });
      const sourceWeekStart = new Date(BASE);
      const targetWeekStart = new Date(BASE + 7 * DAY);
      const results = await Promise.allSettled([
        svc.createShifts(staffId, [slot(7, 9, 12)]),
        svc.copyWeek(staffId, sourceWeekStart, targetWeekStart),
      ]);
      const s = summarize(results);
      expect({ round, errors: s.errors.filter((e) => !/chồng/.test(e)) }).toEqual({ round, errors: [] });
      const rows = await liveShifts(staffId);
      // Tuần đích luôn có đúng 2 ca: copyWeek thắng thì createShifts bị từ chối; createShifts thắng thì copyWeek bỏ qua ca chồng và chép nốt ca còn lại.
      expect({ round, target: rows.filter((r) => r.workDate.getTime() >= targetWeekStart.getTime()).length }).toEqual({ round, target: 2 });
    }
  });

  it('(g) hai ca PENDING khác nhau cùng được sửa song song sang một khung giờ: đúng 1 thắng, không ca nào chồng', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const staffId = await newStaff();
      const first = await prisma.shift.create({ data: { staffId, ...slot(0, 15, 16) } });
      const second = await prisma.shift.create({ data: { staffId, ...slot(0, 17, 18) } });
      const target = slot(0, 10, 13);
      const results = await Promise.allSettled([
        svc.updateShift(staffId, first.id, { startAt: target.startAt, endAt: target.endAt }),
        svc.updateShift(staffId, second.id, { startAt: target.startAt, endAt: target.endAt }),
      ]);
      const s = summarize(results);
      expect({ round, fulfilled: s.fulfilled.length, errors: s.errors }).toEqual({
        round,
        fulfilled: 1,
        errors: ['BadRequestException: Ca bị chồng giờ.'],
      });
      expect(await liveShifts(staffId)).toHaveLength(2);
    }
  });
});
