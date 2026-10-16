import { AttendanceJob, computeAutoClose } from './attendance.job';
import type { PrismaService } from '../../../prisma/prisma.service';

const now = new Date('2026-07-03T05:00:00Z');

describe('computeAutoClose', () => {
  it('chưa hết ca → null (không cắt dù không có heartbeat — điện thoại cất túi)', () => {
    const r = computeAutoClose({ shift: { approvedEnd: null, endAt: new Date('2026-07-03T09:00:00Z') } }, now);
    expect(r).toBeNull();
  });

  it('đã quá giờ hết ca → SHIFT_END tại giờ hết ca', () => {
    const end = new Date('2026-07-03T04:00:00Z'); // ca hết lúc 04:00, now 05:00
    const r = computeAutoClose({ shift: { approvedEnd: null, endAt: end } }, now);
    expect(r).toEqual({ at: end, reason: 'SHIFT_END' });
  });

  it('ưu tiên approvedEnd nếu có', () => {
    const r = computeAutoClose(
      { shift: { approvedEnd: new Date('2026-07-03T04:30:00Z'), endAt: new Date('2026-07-03T09:00:00Z') } },
      now,
    );
    expect(r).toEqual({ at: new Date('2026-07-03T04:30:00Z'), reason: 'SHIFT_END' });
  });
});

describe('AttendanceJob.sweep', () => {
  const sess = (id: string, endAt: string) => ({ id, shift: { approvedEnd: null, endAt: new Date(endAt) } });

  function setup(open: ReturnType<typeof sess>[], counts: (args: { where: { id: { in: string[] } } }) => number = (a) => a.where.id.in.length) {
    const update = jest.fn();
    const updateMany = jest.fn(async (args: { where: { id: { in: string[] } } }) => ({ count: counts(args) }));
    const prisma = { attendanceSession: { findMany: jest.fn().mockResolvedValue(open), update, updateMany } } as unknown as PrismaService;
    return { job: new AttendanceJob(prisma), update, updateMany };
  }

  it('phiên cùng quyết định (cùng giờ hết ca) đóng bằng một updateMany; phiên chưa hết ca bỏ qua; closed = tổng count', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const past2 = new Date(Date.now() - 7200_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    const { job, update, updateMany } = setup([sess('a', past), sess('b', past), sess('c', past2), sess('d', past), sess('e', future)]);
    expect(await job.sweep()).toEqual({ closed: 4 });
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b', 'd'] }, checkoutAt: null },
      data: { checkoutAt: new Date(past), closeReason: 'SHIFT_END' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c'] }, checkoutAt: null },
      data: { checkoutAt: new Date(past2), closeReason: 'SHIFT_END' },
    });
  });

  it('closed là count thật: phiên vừa được nhân viên checkout (guard checkoutAt null) không tính', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const { job } = setup([sess('a', past), sess('b', past), sess('c', past)], () => 2);
    expect(await job.sweep()).toEqual({ closed: 2 });
  });

  it('không có phiên nào đến hạn → không gọi update/updateMany', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const { job, update, updateMany } = setup([sess('a', future)]);
    expect(await job.sweep()).toEqual({ closed: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
