import { PrismaService } from '../../src/prisma/prisma.service';
import { AttendanceJob } from '../../src/modules/staff/attendance/attendance.job';
import { createUser, warmPool } from './helpers';

/** AttendanceJob.sweep đóng theo nhóm cùng quyết định bằng updateMany; không ghi đè checkout nhân viên vừa tự chấm. */
describe('AttendanceJob.sweep batched (real Postgres)', () => {
  let prisma: PrismaService;
  let job: AttendanceJob;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    job = new AttendanceJob(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  afterEach(() => jest.restoreAllMocks());

  const hour = 3600_000;
  // Mỗi nhân viên chỉ có 1 phiên mở (unique một phần): "cùng quyết định" = nhiều nhân viên cùng giờ hết ca.
  async function shiftsWithSessions(endAt: Date, sessions: number) {
    const now = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < sessions; i++) {
      const staff = await createUser(prisma, { role: 'STAFF' });
      const shift = await prisma.shift.create({
        data: {
          staffId: staff.id,
          workDate: new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00.000Z'),
          startAt: new Date(endAt.getTime() - 8 * hour),
          endAt,
          status: 'APPROVED',
        },
      });
      const s = await prisma.attendanceSession.create({
        data: { shiftId: shift.id, staffId: staff.id, checkinAt: new Date(now - 2 * hour), checkinLat: 0, checkinLng: 0, checkinIp: '1.1.1.1' },
      });
      ids.push(s.id);
    }
    return { endAt, ids };
  }
  const endIn = (ms: number) => new Date(Math.floor((Date.now() + ms) / 1000) * 1000);

  it('đóng đúng như từng phiên một: cùng ca cùng giờ chốt, ca khác giờ khác, ca chưa hết bỏ qua', async () => {
    const a = await shiftsWithSessions(endIn(-2 * hour), 3);
    const b = await shiftsWithSessions(endIn(-4 * hour), 2);
    const c = await shiftsWithSessions(endIn(+3 * hour), 2);
    const before = { findMany: jest.spyOn(prisma.attendanceSession, 'findMany'), update: jest.spyOn(prisma.attendanceSession, 'update'), updateMany: jest.spyOn(prisma.attendanceSession, 'updateMany') };

    const { closed } = await job.sweep();

    // DB dùng chung có thể còn phiên mở của spec khác đã quá hạn: chỉ đòi hỏi các phiên của spec này.
    expect(closed).toBeGreaterThanOrEqual(5);
    expect(before.update).not.toHaveBeenCalled();
    const rows = await prisma.attendanceSession.findMany({ where: { id: { in: [...a.ids, ...b.ids, ...c.ids] } } });
    for (const r of rows) {
      if (a.ids.includes(r.id)) expect([r.checkoutAt?.getTime(), r.closeReason]).toEqual([a.endAt.getTime(), 'SHIFT_END']);
      else if (b.ids.includes(r.id)) expect([r.checkoutAt?.getTime(), r.closeReason]).toEqual([b.endAt.getTime(), 'SHIFT_END']);
      else expect([r.checkoutAt, r.closeReason]).toEqual([null, null]);
    }
    // Chạy lại: không còn gì để đóng của spec này.
    before.updateMany.mockClear();
    await job.sweep();
    const again = await prisma.attendanceSession.findMany({ where: { id: { in: a.ids } } });
    expect(again.map((r) => r.checkoutAt?.getTime())).toEqual(a.ids.map(() => a.endAt.getTime()));
  });

  it('nhân viên tự checkout giữa lúc đọc và ghi: giữ checkoutAt của nhân viên, closed không tính phiên đó', async () => {
    const a = await shiftsWithSessions(endIn(-2 * hour), 3);
    const employeeCheckout = new Date(Date.now() - 30 * 60_000);
    const realFindMany = prisma.attendanceSession.findMany.bind(prisma.attendanceSession);
    jest.spyOn(prisma.attendanceSession, 'findMany').mockImplementation(((args: never) =>
      (realFindMany(args) as Promise<unknown[]>).then(async (rows) => {
        await prisma.attendanceSession.update({ where: { id: a.ids[1]! }, data: { checkoutAt: employeeCheckout, closeReason: null } });
        return rows;
      })) as never);

    await job.sweep();

    const rows = new Map((await prisma.attendanceSession.findMany({ where: { id: { in: a.ids } } })).map((r) => [r.id, r]));
    expect(rows.get(a.ids[1]!)!.checkoutAt?.getTime()).toBe(employeeCheckout.getTime());
    expect(rows.get(a.ids[1]!)!.closeReason).toBeNull();
    for (const id of [a.ids[0]!, a.ids[2]!]) {
      expect(rows.get(id)!.checkoutAt?.getTime()).toBe(a.endAt.getTime());
      expect(rows.get(id)!.closeReason).toBe('SHIFT_END');
    }
  });
});
