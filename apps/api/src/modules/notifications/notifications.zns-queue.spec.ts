import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

const ZNS_TEMPLATE = { code: 'ORDER_CONFIRMED', channel: 'ZNS', bodyTemplate: 'x', zaloTemplateId: 'zt-1' };
const JOB = { notificationLogId: 'log-2', phone: '0900000000', templateId: 'zt-1', templateData: {} };

function setup(opts: { queueAdd?: jest.Mock; sendTemplate?: jest.Mock; status?: string; payload?: unknown } = {}) {
  let seq = 0;
  const create = jest.fn().mockImplementation(async () => ({ id: `log-${++seq}` }));
  const update = jest.fn().mockResolvedValue({});
  const findUnique = jest.fn().mockResolvedValue({ status: opts.status ?? 'PENDING', payload: opts.payload ?? { data: {} } });
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
  it('R3-UI-11: mọi lượt gửi của một log mang cùng tracking_id = id log để Zalo đối soát được các lần gửi lại', async () => {
    const { svc, sendTemplate } = setup();
    await svc.deliverZns(JOB, false);
    expect(sendTemplate).toHaveBeenCalledWith('0900000000', 'zt-1', {}, 'log-2');
  });

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

  // withQueueTimeout báo lỗi dù Redis đã nhận job. Log retryZns đã nhả khoá (lượt gửi lại sau tạo log mới) nên job muộn gửi tiếp là gửi đôi.
  it('log FAILED đã nhả khoá chống trùng (xếp hàng báo lỗi nhưng job vẫn vào hàng) → job chạy muộn không gửi ZNS', async () => {
    const { svc, sendTemplate, update } = setup({
      status: 'FAILED',
      payload: { data: {}, dedupeKey: 'tier-drop:2026-11-10:failed:log-2' },
    });
    expect(await svc.deliverZns(JOB, false)).toBe('SKIPPED');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  // Tin thường (không retryZns) không mang khoá để nhả và không có đường gửi lại nào khác ngoài job này.
  it('log FAILED vì xếp hàng quá hạn nhưng không có khoá để nhả (tin thường) → job chạy muộn vẫn gửi và log thành SENT', async () => {
    const { svc, sendTemplate, update } = setup({ status: 'FAILED', payload: { data: {} } });
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 'log-2' }, data: { status: 'SENT', error: null } });
  });

  it('log FAILED mang khoá của log khác (không phải khoá đã nhả của chính nó) → vẫn gửi', async () => {
    const { svc, sendTemplate } = setup({ status: 'FAILED', payload: { data: {}, dedupeKey: 'tier-drop:2026-11-10:failed:log-9' } });
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it.each(['PENDING', 'RETRYING'])('log %s → vẫn gửi (lượt đầu và lượt thử lại hợp lệ)', async (status) => {
    const { svc, sendTemplate } = setup({ status });
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsService: tin báo trước hạ hạng gửi lại ZNS sau khi lần trước hỏng (retryZns)', () => {
  const KEY = { dedupeKey: 'tier-drop:2026-11-10', retryZns: true };

  /** Sổ log trong bộ nhớ: findFirst đọc đúng điều kiện (khách, kênh, khoá trong payload, trạng thái) như Postgres. */
  function memorySetup(opts: { queueAdd?: jest.Mock } = {}) {
    interface Row { id: string; userId: string; channel: string; status: string; payload: { dedupeKey?: string } }
    const rows: Row[] = [];
    const matches = (r: Row, w: { userId: string; channel: string; payload: { equals: string }; status?: { in: string[] } }) =>
      r.userId === w.userId && r.channel === w.channel && r.payload?.dedupeKey === w.payload.equals && (!w.status || w.status.in.includes(r.status));
    const notificationLog = {
      create: jest.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
        const row = { id: `log-${rows.length + 1}`, ...data } as Row;
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: Parameters<typeof matches>[1] }) => rows.find((r) => matches(r, where)) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
    };
    const prisma = {
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(ZNS_TEMPLATE) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0900000000' }) },
      notificationLog,
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: jest.fn(), notificationLog })),
    } as unknown as PrismaService;
    const add = opts.queueAdd ?? jest.fn().mockResolvedValue({});
    const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
    const svc = new NotificationsService(prisma, { sendTemplate: jest.fn() } as unknown as ZnsClient, analytics, { add } as never);
    const znsRows = () => rows.filter((r) => r.channel === 'ZNS');
    const inAppRows = () => rows.filter((r) => r.channel === 'INAPP');
    return { svc, rows, add, znsRows, inAppRows };
  }

  it('xếp hàng đợi lỗi → log ZNS FAILED nhả khoá chống gửi trùng và notify ném để nơi gọi nhả phần việc của mình', async () => {
    const { svc, znsRows, inAppRows } = memorySetup({ queueAdd: jest.fn().mockRejectedValue(new Error('redis down')) });
    await expect(svc.notify('u1', 'ORDER_CONFIRMED', {}, KEY)).rejects.toThrow('redis down');
    expect(inAppRows()).toHaveLength(1);
    expect(znsRows()).toHaveLength(1);
    expect(znsRows()[0]).toMatchObject({ status: 'FAILED' });
    expect(znsRows()[0]!.payload.dedupeKey).not.toBe(KEY.dedupeKey);
  });

  it('gọi lại notify với retryZns sau lần xếp hàng lỗi → chỉ tạo log ZNS mới và xếp job, không lưu thêm tin trong app', async () => {
    const m = memorySetup();
    (m.add as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
    await expect(m.svc.notify('u1', 'ORDER_CONFIRMED', {}, KEY)).rejects.toThrow();
    await m.svc.notify('u1', 'ORDER_CONFIRMED', {}, KEY);
    expect(m.inAppRows()).toHaveLength(1);
    expect(m.znsRows().map((r) => r.status)).toEqual(['FAILED', 'PENDING']);
    expect(m.znsRows()[1]!.payload.dedupeKey).toBe(KEY.dedupeKey);
    expect(m.add).toHaveBeenCalledTimes(2);
  });

  it('log ZNS đã FAILED vì Zalo từ chối (còn nguyên khoá) không chặn lượt gửi lại', async () => {
    const m = memorySetup();
    await m.svc.notify('u1', 'ORDER_CONFIRMED', {}, KEY);
    m.znsRows()[0]!.status = 'FAILED';
    await m.svc.notify('u1', 'ORDER_CONFIRMED', {}, KEY);
    expect(m.znsRows().map((r) => r.status)).toEqual(['FAILED', 'PENDING']);
    expect(m.inAppRows()).toHaveLength(1);
  });

  it.each(['SENT', 'PENDING', 'RETRYING'])('log ZNS đang %s vẫn chặn: không gửi ZNS đôi', async (status) => {
    const m = memorySetup();
    await m.svc.notify('u1', 'ORDER_CONFIRMED', {}, KEY);
    m.znsRows()[0]!.status = status;
    await m.svc.notify('u1', 'ORDER_CONFIRMED', {}, KEY);
    expect(m.znsRows()).toHaveLength(1);
    expect(m.inAppRows()).toHaveLength(1);
    expect(m.add).toHaveBeenCalledTimes(1);
  });
});
