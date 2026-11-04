import { NotificationsService, ZNS_REVIEW_PREFIX } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

function setup(count = 1) {
  const updateMany = jest.fn().mockResolvedValue({ count });
  const executeRaw = jest.fn().mockResolvedValue(count);
  const prisma = { notificationLog: { updateMany }, $executeRaw: executeRaw } as unknown as PrismaService;
  const svc = new NotificationsService(prisma, {} as ZnsClient, {} as AnalyticsEventsService);
  return { svc, updateMany, executeRaw };
}

describe('NotificationsService: đóng log ZNS kẹt vì job đã chết', () => {
  it('closeStuckZnsLog: CAS chỉ từ PENDING/RETRYING sang FAILED kèm lý do, không đụng payload (không nhả khoá)', async () => {
    const { svc, updateMany } = setup(1);
    await expect(svc.closeStuckZnsLog('log-1', 'Job hỏng')).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'log-1', status: { in: ['PENDING', 'RETRYING'] } },
      data: { status: 'FAILED', error: 'Job hỏng' },
    });
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
