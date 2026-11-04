import { NotificationsService, ZNS_REVIEW_PREFIX } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

function setup(count = 1, payload: unknown = { data: { a: '1' } }) {
  const updateMany = jest.fn().mockResolvedValue({ count });
  const executeRaw = jest.fn().mockResolvedValue(count);
  const findUnique = jest.fn().mockResolvedValue(payload === null ? null : { payload });
  const prisma = { notificationLog: { updateMany, findUnique }, $executeRaw: executeRaw } as unknown as PrismaService;
  const svc = new NotificationsService(prisma, {} as ZnsClient, {} as AnalyticsEventsService);
  return { svc, updateMany, executeRaw };
}

describe('NotificationsService: đóng log ZNS kẹt vì job đã chết', () => {
  it('closeStuckZnsLog: CAS chỉ từ PENDING/RETRYING sang FAILED kèm lý do; log không có dedupeKey thì không đụng payload', async () => {
    const { svc, updateMany } = setup(1);
    await expect(svc.closeStuckZnsLog('log-1', 'Job hỏng')).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', status: { in: ['PENDING', 'RETRYING'] } },
      data: { status: 'FAILED', error: 'Job hỏng' },
    });
  });

  it('closeStuckZnsLog: log có dedupeKey thì nhả khoá (<khoá>:failed:<id>), giữ data và dedupeWithinMs', async () => {
    const { svc, updateMany } = setup(1, { data: { a: '1' }, dedupeKey: 'k1', dedupeWithinMs: 3600000 });
    await svc.closeStuckZnsLog('log-1', 'x');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', status: { in: ['PENDING', 'RETRYING'] } },
      data: { status: 'FAILED', error: 'x', payload: { data: { a: '1' }, dedupeKey: 'k1:failed:log-1', dedupeWithinMs: 3600000 } },
    });
  });

  it('closeStuckZnsLog: khoá đã nhả rồi thì không nhả lần hai (không nối :failed: chồng)', async () => {
    const { svc, updateMany } = setup(1, { data: {}, dedupeKey: 'k1:failed:log-1' });
    await svc.closeStuckZnsLog('log-1', 'x');
    expect(updateMany.mock.calls[0]![0].data).toEqual({ status: 'FAILED', error: 'x' });
  });

  it('closeStuckZnsLog: log không còn → false, không ghi', async () => {
    const { svc, updateMany } = setup(1, null);
    await expect(svc.closeStuckZnsLog('log-1', 'x')).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('closeStuckZnsLog: CAS theo đúng trạng thái đã thấy khi nơi gọi chỉ định `from`', async () => {
    const { svc, updateMany } = setup(1);
    await svc.closeStuckZnsLog('log-1', 'x', ['PENDING']);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'log-1', status: { in: ['PENDING'] } }, data: { status: 'FAILED', error: 'x' } });
  });

  it('closeStuckZnsLog: log đã SENT/FAILED (count 0) → false', async () => {
    const { svc } = setup(0);
    await expect(svc.closeStuckZnsLog('log-1', 'x')).resolves.toBe(false);
  });

  it('markStuckZnsSent: CAS chỉ từ RETRYING sang SENT, xoá error', async () => {
    const { svc, updateMany } = setup(1);
    await expect(svc.markStuckZnsSent('log-1')).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'log-1', status: 'RETRYING' }, data: { status: 'SENT', error: null } });
  });

  it('markZnsLogForReview: đánh dấu bằng tiền tố ở cột error, giữ status; true khi ghi được, false khi đã đánh dấu hoặc đổi trạng thái', async () => {
    const a = setup(1);
    await expect(a.svc.markZnsLogForReview('log-1', 'RETRYING', 'ghi chú')).resolves.toBe(true);
    const sqlText = (a.executeRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(sqlText).toContain('UPDATE notification_logs');
    expect(sqlText).not.toMatch(/status\s*=\s*'/);
    expect(a.executeRaw.mock.calls[0]!.slice(1)).toEqual(expect.arrayContaining([`${ZNS_REVIEW_PREFIX}ghi chú`, 'log-1', 'RETRYING']));
    await expect(setup(0).svc.markZnsLogForReview('log-1', 'RETRYING', 'x')).resolves.toBe(false);
  });
});
