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

  describe('closeStuckZnsLog với olderThan và keepError (hết hạn RETRYING 24 giờ)', () => {
    const cutoff = new Date('2026-11-05T10:00:00.000Z');
    const withLog = (log: unknown, count = 1) => {
      const updateMany = jest.fn().mockResolvedValue({ count });
      const findUnique = jest.fn().mockResolvedValue(log);
      const prisma = { notificationLog: { updateMany, findUnique }, $executeRaw: jest.fn() } as unknown as PrismaService;
      return { svc: new NotificationsService(prisma, {} as ZnsClient, {} as AnalyticsEventsService), updateMany };
    };

    it('CAS thêm sentAt cũ hơn mốc và đúng lỗi đã đọc; ghi lý do mới, giữ lỗi cũ (kể cả tiền tố đối soát) phía sau', async () => {
      const { svc, updateMany } = withLog({ payload: { data: {} }, error: `${ZNS_REVIEW_PREFIX}không rõ` });
      await expect(svc.closeStuckZnsLog('log-1', 'Hết thời gian chờ', ['RETRYING'], { olderThan: cutoff, keepError: true })).resolves.toBe(true);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'log-1', status: { in: ['RETRYING'] }, sentAt: { lt: cutoff }, error: `${ZNS_REVIEW_PREFIX}không rõ` },
        data: { status: 'FAILED', error: `Hết thời gian chờ | ${ZNS_REVIEW_PREFIX}không rõ` },
      });
    });

    it('log chưa có lỗi: lý do đứng một mình, CAS theo error null', async () => {
      const { svc, updateMany } = withLog({ payload: { data: {} }, error: null });
      await svc.closeStuckZnsLog('log-1', 'Hết thời gian chờ', ['RETRYING'], { olderThan: cutoff, keepError: true });
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'log-1', status: { in: ['RETRYING'] }, sentAt: { lt: cutoff }, error: null },
        data: { status: 'FAILED', error: 'Hết thời gian chờ' },
      });
    });

    it('lỗi cũ dài bị cắt 500 ký tự để cột error không phình', async () => {
      const { svc, updateMany } = withLog({ payload: { data: {} }, error: 'x'.repeat(2000) });
      await svc.closeStuckZnsLog('log-1', 'R', ['RETRYING'], { olderThan: cutoff, keepError: true });
      expect((updateMany.mock.calls[0]![0].data as { error: string }).error).toBe(`R | ${'x'.repeat(500)}`);
    });

    it('log có dedupeKey vẫn nhả khoá như mọi đường đóng khác (job sống lại ra SKIPPED, không gửi)', async () => {
      const { svc, updateMany } = withLog({ payload: { data: {}, dedupeKey: 'k1', dedupeWithinMs: 86_400_000 }, error: null });
      await svc.closeStuckZnsLog('log-1', 'R', ['RETRYING'], { olderThan: cutoff, keepError: true });
      expect(updateMany.mock.calls[0]![0].data).toEqual({ status: 'FAILED', error: 'R', payload: { data: {}, dedupeKey: 'k1:failed:log-1', dedupeWithinMs: 86_400_000 } });
    });

    it('không truyền tuỳ chọn: hành vi cũ giữ nguyên (không thêm sentAt, không đọc error)', async () => {
      const { svc, updateMany } = withLog({ payload: { data: {} }, error: 'cũ' });
      await svc.closeStuckZnsLog('log-1', 'mới');
      expect(updateMany).toHaveBeenCalledWith({ where: { id: 'log-1', status: { in: ['PENDING', 'RETRYING'] } }, data: { status: 'FAILED', error: 'mới' } });
    });
  });

  it('closeStuckZnsLog: log đã SENT/FAILED (count 0) → false', async () => {
    const { svc } = setup(0);
    await expect(svc.closeStuckZnsLog('log-1', 'x')).resolves.toBe(false);
  });

  it('markStuckZnsSent: CAS chỉ từ RETRYING sang SENT, xoá error, khôi phục khoá đã nhả của chính log trong cùng câu UPDATE', async () => {
    const { svc, executeRaw } = setup(1);
    await expect(svc.markStuckZnsSent('log-1')).resolves.toBe(true);
    const sqlText = (executeRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(sqlText).toContain("SET status = 'SENT', \"error\" = NULL");
    expect(sqlText).toContain("jsonb_set(payload, '{dedupeKey}'");
    expect(executeRaw.mock.calls[0]!.slice(1)).toEqual(expect.arrayContaining([':failed:log-1', 'log-1', 'RETRYING']));
    await expect(setup(0).svc.markStuckZnsSent('log-1')).resolves.toBe(false);
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

  it('deliverZns: nhận log thì xoá tiền tố chờ đối soát ở cột error (chỉ log mang tiền tố)', async () => {
    const { svc, updateMany } = setup(1, { data: {} });
    (svc as unknown as { zns: unknown }).zns = { sendTemplate: jest.fn().mockResolvedValue({ ok: false, retryable: true, code: -1, reason: 'x' }) };
    await svc.deliverZns({ notificationLogId: 'log-1', phone: '0900000000', templateId: 't', templateData: {} }, false).catch(() => undefined);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'log-1', error: { startsWith: ZNS_REVIEW_PREFIX } }, data: { error: null } });
  });
});
