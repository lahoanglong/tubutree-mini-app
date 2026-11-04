import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ZnsStuckLogCron } from './zns-stuck-log.cron';
import type { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { runExclusive } from '../../common/cron-leader/run-exclusive';
import { holdsLease } from '../../common/cron-leader/run-exclusive.fixtures';

jest.mock('../../common/cron-leader/run-exclusive');

type LogRow = { id: string; status: 'PENDING' | 'RETRYING' };
type JobSpec = { state: string; returnvalue?: unknown } | null | Error;

function setup(logs: LogRow[], jobs: Record<string, JobSpec>, opts: { noQueue?: boolean; acquired?: boolean } = {}) {
  (runExclusive as jest.Mock).mockImplementation(holdsLease(opts.acquired ?? true));
  const findMany = jest.fn().mockResolvedValue(logs);
  const prisma = { notificationLog: { findMany } } as unknown as PrismaService;
  const closeStuckZnsLog = jest.fn().mockResolvedValue(true);
  const markStuckZnsSent = jest.fn().mockResolvedValue(true);
  const notifications = { closeStuckZnsLog, markStuckZnsSent } as unknown as NotificationsService;
  const getJob = jest.fn(async (jobId: string) => {
    const spec = jobs[jobId.replace(/^zns-/, '')];
    if (spec instanceof Error) throw spec;
    if (!spec) return undefined;
    return { getState: async () => spec.state, returnvalue: spec.returnvalue };
  });
  const cron = new ZnsStuckLogCron(prisma, notifications, opts.noQueue ? undefined : ({ getJob } as unknown as Queue));
  return { cron, findMany, closeStuckZnsLog, markStuckZnsSent, getJob };
}

let info: jest.SpyInstance;
let warn: jest.SpyInstance;
beforeEach(() => {
  info = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('ZnsStuckLogCron: truy vấn', () => {
  it('chỉ lấy log ZNS PENDING/RETRYING có sentAt cũ hơn 1 giờ, cũ nhất trước, tối đa 200', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-05T10:00:00.000Z'));
    try {
      const { cron, findMany } = setup([], {});
      await cron.sweepStuckZnsLogs();
      expect(findMany).toHaveBeenCalledWith({
        where: { channel: 'ZNS', status: { in: ['PENDING', 'RETRYING'] }, sentAt: { lt: new Date('2026-11-05T09:00:00.000Z') } },
        orderBy: { sentAt: 'asc' },
        take: 200,
        select: { id: true, status: true },
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ZnsStuckLogCron: nhánh theo trạng thái job', () => {
  it('job failed → đóng FAILED (cả PENDING lẫn RETRYING)', async () => {
    const { cron, closeStuckZnsLog } = setup([{ id: 'a', status: 'PENDING' }, { id: 'b', status: 'RETRYING' }], { a: { state: 'failed' }, b: { state: 'failed' } });
    await expect(cron.sweepStuckZnsLogs()).resolves.toEqual({ scanned: 2, closed: 2, sent: 0, ambiguous: 0, alive: 0 });
    expect(closeStuckZnsLog).toHaveBeenCalledWith('a', expect.stringContaining('hỏng'));
    expect(closeStuckZnsLog).toHaveBeenCalledWith('b', expect.stringContaining('hỏng'));
  });

  it('không còn job + log PENDING (chưa từng được worker nhận) → đóng FAILED với lý do riêng', async () => {
    const { cron, closeStuckZnsLog } = setup([{ id: 'a', status: 'PENDING' }], {});
    await expect(cron.sweepStuckZnsLogs()).resolves.toMatchObject({ closed: 1, ambiguous: 0 });
    expect(closeStuckZnsLog).toHaveBeenCalledWith('a', expect.stringContaining('không còn'));
  });

  it('không còn job + log RETRYING (Zalo có thể đã nhận, job hoàn tất bị dọn khỏi Redis) → mơ hồ, KHÔNG đóng', async () => {
    const { cron, closeStuckZnsLog, markStuckZnsSent } = setup([{ id: 'a', status: 'RETRYING' }], {});
    await expect(cron.sweepStuckZnsLogs()).resolves.toMatchObject({ closed: 0, sent: 0, ambiguous: 1 });
    expect(closeStuckZnsLog).not.toHaveBeenCalled();
    expect(markStuckZnsSent).not.toHaveBeenCalled();
  });

  it("job completed có returnvalue 'SENT' + log RETRYING → ghi SENT (CAS), không đóng FAILED", async () => {
    const { cron, closeStuckZnsLog, markStuckZnsSent } = setup([{ id: 'a', status: 'RETRYING' }], { a: { state: 'completed', returnvalue: 'SENT' } });
    await expect(cron.sweepStuckZnsLogs()).resolves.toEqual({ scanned: 1, closed: 0, sent: 1, ambiguous: 0, alive: 0 });
    expect(markStuckZnsSent).toHaveBeenCalledWith('a');
    expect(closeStuckZnsLog).not.toHaveBeenCalled();
  });

  it("job completed không có returnvalue 'SENT' → mơ hồ, không đóng, không ghi SENT", async () => {
    const { cron, closeStuckZnsLog, markStuckZnsSent } = setup(
      [{ id: 'a', status: 'RETRYING' }, { id: 'b', status: 'PENDING' }, { id: 'c', status: 'RETRYING' }],
      { a: { state: 'completed' }, b: { state: 'completed', returnvalue: 'SENT' }, c: { state: 'completed', returnvalue: 'FAILED' } },
    );
    await expect(cron.sweepStuckZnsLogs()).resolves.toMatchObject({ closed: 0, sent: 0, ambiguous: 3 });
    expect(closeStuckZnsLog).not.toHaveBeenCalled();
    expect(markStuckZnsSent).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children', 'paused', 'unknown'])('job %s → còn sống, bỏ qua', async (state) => {
    const { cron, closeStuckZnsLog, markStuckZnsSent } = setup([{ id: 'a', status: 'RETRYING' }], { a: { state } });
    await expect(cron.sweepStuckZnsLogs()).resolves.toEqual({ scanned: 1, closed: 0, sent: 0, ambiguous: 0, alive: 1 });
    expect(closeStuckZnsLog).not.toHaveBeenCalled();
    expect(markStuckZnsSent).not.toHaveBeenCalled();
  });

  it('đọc job theo jobId zns-<logId>', async () => {
    const { cron, getJob } = setup([{ id: 'abc', status: 'PENDING' }], { abc: { state: 'delayed' } });
    await cron.sweepStuckZnsLogs();
    expect(getJob).toHaveBeenCalledWith('zns-abc');
  });

  it('CAS thua (log đã được đường khác đóng, trả false) → không tính vào closed/sent', async () => {
    const { cron, closeStuckZnsLog, markStuckZnsSent } = setup([{ id: 'a', status: 'PENDING' }, { id: 'b', status: 'RETRYING' }], { a: { state: 'failed' }, b: { state: 'completed', returnvalue: 'SENT' } });
    closeStuckZnsLog.mockResolvedValue(false);
    markStuckZnsSent.mockResolvedValue(false);
    await expect(cron.sweepStuckZnsLogs()).resolves.toEqual({ scanned: 2, closed: 0, sent: 0, ambiguous: 0, alive: 0 });
  });
});

describe('ZnsStuckLogCron: an toàn', () => {
  it('đọc Redis lỗi ở bất kỳ log nào → bỏ cả lượt, không đóng log nào kể cả log đã đọc được trước đó', async () => {
    const { cron, closeStuckZnsLog, markStuckZnsSent } = setup([{ id: 'a', status: 'PENDING' }, { id: 'b', status: 'PENDING' }], { a: { state: 'failed' }, b: new Error('redis down') });
    await expect(cron.sweepStuckZnsLogs()).resolves.toEqual({ skipped: 'REDIS' });
    expect(closeStuckZnsLog).not.toHaveBeenCalled();
    expect(markStuckZnsSent).not.toHaveBeenCalled();
  });

  it('không có hàng đợi (test, chạy không Redis) → không truy vấn, không làm gì', async () => {
    const { cron, findMany, closeStuckZnsLog } = setup([{ id: 'a', status: 'PENDING' }], {}, { noQueue: true });
    await expect(cron.sweepStuckZnsLogs()).resolves.toEqual({ skipped: 'NO_QUEUE' });
    expect(findMany).not.toHaveBeenCalled();
    expect(closeStuckZnsLog).not.toHaveBeenCalled();
  });

  it('không giành được khoá lượt chạy (bản API khác đang quét) → không truy vấn', async () => {
    const { cron, findMany } = setup([{ id: 'a', status: 'PENDING' }], {}, { acquired: false });
    await expect(cron.sweepStuckZnsLogs()).resolves.toEqual({ skipped: 'LOCKED' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('ghi đóng ném lỗi giữa chừng → ghi log lỗi nhưng vẫn xử lý các log sau', async () => {
    const { cron, closeStuckZnsLog } = setup([{ id: 'a', status: 'PENDING' }, { id: 'b', status: 'PENDING' }], { a: { state: 'failed' }, b: { state: 'failed' } });
    closeStuckZnsLog.mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(true);
    await expect(cron.sweepStuckZnsLogs()).resolves.toMatchObject({ scanned: 2, closed: 1 });
    expect(closeStuckZnsLog).toHaveBeenCalledTimes(2);
  });

  it('ghi một dòng log khi closed + sent + ambiguous > 0, im lặng khi chỉ có job còn sống', async () => {
    await setup([{ id: 'a', status: 'RETRYING' }], { a: { state: 'delayed' } }).cron.sweepStuckZnsLogs();
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    await setup([{ id: 'a', status: 'PENDING' }], { a: { state: 'failed' } }).cron.sweepStuckZnsLogs();
    expect(info.mock.calls.length + warn.mock.calls.length).toBe(1);
  });
});
