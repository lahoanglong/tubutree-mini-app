import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

const ZNS_TEMPLATE = { code: 'ORDER_CONFIRMED', channel: 'ZNS', bodyTemplate: 'x', zaloTemplateId: 'zt-1' };
const JOB = { notificationLogId: 'log-2', phone: '0900000000', templateId: 'zt-1', templateData: {} };

function setup(opts: { queueAdd?: jest.Mock; sendTemplate?: jest.Mock; status?: string } = {}) {
  let seq = 0;
  const create = jest.fn().mockImplementation(async () => ({ id: `log-${++seq}` }));
  const update = jest.fn().mockResolvedValue({});
  const findUnique = jest.fn().mockResolvedValue({ status: opts.status ?? 'PENDING' });
  const prisma = {
    notificationTemplate: { findUnique: jest.fn().mockResolvedValue(ZNS_TEMPLATE) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0900000000' }) },
    notificationLog: { create, update, findUnique },
  } as unknown as PrismaService;
  const add = opts.queueAdd ?? jest.fn().mockResolvedValue({});
  const sendTemplate = opts.sendTemplate ?? jest.fn().mockResolvedValue({ ok: true });
  const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
  const svc = new NotificationsService(prisma, { sendTemplate } as unknown as ZnsClient, analytics, { add } as never);
  return { svc, create, update, add, sendTemplate };
}

describe('NotificationsService: ZNS đi qua hàng đợi', () => {
  it('R2-ENGAGE-2: notify() không chờ Zalo — ZNS treo vẫn trả về ngay, chỉ ghi log PENDING và xếp job', async () => {
    const hang = jest.fn().mockReturnValue(new Promise(() => undefined));
    const { svc, create, add, sendTemplate } = setup({ sendTemplate: hang });
    await svc.notify('u1', 'ORDER_CONFIRMED', { order_code: 'T1' });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(create.mock.calls[1][0].data).toMatchObject({ channel: 'ZNS', status: 'PENDING' });
    expect(add).toHaveBeenCalledWith(
      'zns-send',
      expect.objectContaining({ notificationLogId: 'log-2', phone: '0900000000', templateId: 'zt-1' }),
      expect.objectContaining({ jobId: 'zns-log-2', attempts: 6 }),
    );
  });

  it('xếp job lỗi (Redis) → log ZNS FAILED kèm lý do, notify() không ném', async () => {
    const { svc, update } = setup({ queueAdd: jest.fn().mockRejectedValue(new Error('redis down')) });
    await expect(svc.notify('u1', 'ORDER_CONFIRMED', {})).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'log-2' },
      data: { status: 'FAILED', error: expect.stringContaining('redis down') },
    });
  });
});

describe('NotificationsService.deliverZns', () => {
  it('thành công → SENT, xoá lỗi của lượt trước', async () => {
    const { svc, update } = setup();
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(update).toHaveBeenCalledWith({ where: { id: 'log-2' }, data: { status: 'SENT', error: null } });
  });

  it('HTTP 200 + error != 0 không phải SENT: lỗi vĩnh viễn → FAILED ngay (kể cả còn lượt), lưu mã + lý do', async () => {
    const failure = { ok: false, retryable: false, code: -118, reason: 'user not exist' };
    const { svc, update } = setup({ sendTemplate: jest.fn().mockResolvedValue(failure) });
    expect(await svc.deliverZns(JOB, false)).toBe('FAILED');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'log-2' },
      data: { status: 'FAILED', error: expect.stringMatching(/-118.*user not exist/) },
    });
  });

  it('lỗi tạm thời còn lượt → RETRYING + RETRY; hết lượt → FAILED', async () => {
    const failure = { ok: false, retryable: true, code: -124, reason: 'token expired' };
    const { svc, update } = setup({ sendTemplate: jest.fn().mockResolvedValue(failure) });
    expect(await svc.deliverZns(JOB, false)).toBe('RETRY');
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'log-2' },
      data: { status: 'RETRYING', error: expect.stringContaining('token expired') },
    });
    expect(await svc.deliverZns(JOB, true)).toBe('FAILED');
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'log-2' },
      data: { status: 'FAILED', error: expect.stringContaining('token expired') },
    });
  });

  it('log đã SENT (job chạy lặp) → không gửi lần nữa', async () => {
    const { svc, sendTemplate } = setup({ status: 'SENT' });
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
