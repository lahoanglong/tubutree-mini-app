import { Logger } from '@nestjs/common';
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
  // Ghi SENT là một câu SQL thô (khôi phục khoá đã nhả trong cùng câu, xem writeSent); executeRaw đếm các lần ghi đó.
  const executeRaw = jest.fn().mockResolvedValue(1);
  // Câu nhận log của deliverZns (status in [...]) chỉ thắng khi log còn PENDING/RETRYING; câu đóng log của dispatchZns (status: 'PENDING') luôn khớp.
  const claimable = ['PENDING', 'RETRYING'].includes(opts.status ?? 'PENDING');
  const updateMany = jest.fn().mockImplementation(async ({ where }: { where: { status: string | { in: string[] } } }) => ({
    count: typeof where.status === 'string' || claimable ? 1 : 0,
  }));
  const findUnique = jest.fn().mockResolvedValue({ status: opts.status ?? 'PENDING', payload: opts.payload ?? { data: {} } });
  const prisma = {
    notificationTemplate: { findUnique: jest.fn().mockResolvedValue(ZNS_TEMPLATE) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0900000000' }) },
    notificationLog: { create, update, updateMany, findUnique },
    $executeRaw: executeRaw,
  } as unknown as PrismaService;
  const add = opts.queueAdd ?? jest.fn().mockResolvedValue({});
  const sendTemplate = opts.sendTemplate ?? jest.fn().mockResolvedValue({ ok: true });
  const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
  const svc = new NotificationsService(prisma, { sendTemplate } as unknown as ZnsClient, analytics, { add } as never);
  return { svc, create, update, updateMany, add, sendTemplate, executeRaw, findUnique };
}

/** Chuỗi SQL của lần gọi $executeRaw thứ n (tagged template). */
const sqlOf = (executeRaw: jest.Mock, n = 0) => (executeRaw.mock.calls[n]![0] as TemplateStringsArray).join('?');

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
    const { svc, updateMany } = setup({ queueAdd: jest.fn().mockRejectedValue(new Error('redis down')) });
    await expect(svc.notify('u1', 'ORDER_CONFIRMED', {})).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'log-2', status: 'PENDING' },
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

  it('R-181: nhận log (PENDING/RETRYING) bằng một câu có điều kiện TRƯỚC khi gọi Zalo', async () => {
    const { svc, updateMany, sendTemplate } = setup();
    const order: string[] = [];
    // Chỉ câu nhận log (có điều kiện status) tính là 'claim'; câu bỏ tiền tố chờ đối soát đi sau nó và không đổi thứ tự trước/sau Zalo.
    updateMany.mockImplementation(async ({ where }: { where: { status?: unknown } }) => (where.status ? order.push('claim') : undefined, { count: 1 }));
    sendTemplate.mockImplementation(async () => (order.push('send'), { ok: true }));
    await svc.deliverZns(JOB, false);
    expect(order).toEqual(['claim', 'send']);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'log-2', status: { in: ['PENDING', 'RETRYING'] } }, data: { status: 'RETRYING' } });
  });

  it('thành công → SENT, xoá lỗi của lượt trước', async () => {
    const { svc, executeRaw } = setup();
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(executeRaw)).toMatch(/SET status = 'SENT', "error" = NULL/);
    expect(executeRaw.mock.calls[0]).toContain('log-2');
  });

  it('L2-03: ghi SENT lỗi một lần sau khi Zalo đã nhận → ghi lại được, không gửi lần hai', async () => {
    const { svc, executeRaw, sendTemplate } = setup();
    executeRaw.mockRejectedValueOnce(new Error('db blip'));
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(sqlOf(executeRaw, 1)).toMatch(/SET status = 'SENT'/);
  });

  it('ghi SENT trúng 0 dòng (log không còn) → logger.error, không ném và không gửi lại', async () => {
    const { svc, executeRaw, sendTemplate } = setup();
    executeRaw.mockResolvedValue(0);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      expect(await svc.deliverZns(JOB, false)).toBe('SENT');
      expect(sendTemplate).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('log-2'));
    } finally {
      error.mockRestore();
    }
  });

  it('L2-03: ghi SENT lỗi cả 3 lần → nuốt lỗi (job không ném để BullMQ gửi lại), Zalo chỉ được gọi một lần', async () => {
    const { svc, executeRaw, sendTemplate } = setup();
    executeRaw.mockRejectedValue(new Error('db down'));
    await expect(svc.deliverZns(JOB, false)).resolves.toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it('HTTP 200 + error != 0 không phải SENT: lỗi vĩnh viễn → FAILED ngay (kể cả còn lượt), lưu mã + lý do, trong một câu UPDATE không đè SENT', async () => {
    const failure = { ok: false, retryable: false, code: -118, reason: 'user not exist' };
    const { svc, update, executeRaw } = setup({ sendTemplate: jest.fn().mockResolvedValue(failure) });
    expect(await svc.deliverZns(JOB, false)).toBe('FAILED');
    expect(update).not.toHaveBeenCalled();
    expect(sqlOf(executeRaw)).toMatch(/status <> 'SENT'/);
    expect(executeRaw.mock.calls[0]).toEqual(expect.arrayContaining(['FAILED', 'log-2', expect.stringMatching(/-118.*user not exist/)]));
  });

  it('lỗi tạm thời còn lượt → RETRYING + RETRY; hết lượt → FAILED (cả hai qua câu UPDATE có điều kiện status <> SENT)', async () => {
    const failure = { ok: false, retryable: true, code: -124, reason: 'token expired' };
    const { svc, update, executeRaw } = setup({ sendTemplate: jest.fn().mockResolvedValue(failure) });
    expect(await svc.deliverZns(JOB, false)).toBe('RETRY');
    expect(executeRaw.mock.calls[0]).toEqual(expect.arrayContaining(['RETRYING', 'log-2', expect.stringContaining('token expired')]));
    expect(await svc.deliverZns(JOB, true)).toBe('FAILED');
    expect(executeRaw.mock.calls[1]).toEqual(expect.arrayContaining(['FAILED', 'log-2', expect.stringContaining('token expired')]));
    expect(sqlOf(executeRaw, 1)).toMatch(/status <> 'SENT'/);
    expect(update).not.toHaveBeenCalled();
  });

  // Worker khác đã ghi SENT trong lúc ta chờ Zalo: UPDATE trúng 0 dòng, log đã SENT -> báo SENT (processor không ném, BullMQ không thử lại).
  it.each([
    ['lỗi vĩnh viễn', { ok: false, retryable: false, code: -118, reason: 'x' }, false],
    ['lỗi tạm thời còn lượt', { ok: false, retryable: true, code: -124, reason: 'x' }, false],
    ['lỗi tạm thời lượt cuối', { ok: false, retryable: true, code: -124, reason: 'x' }, true],
  ])('%s nhưng log đã SENT bởi worker khác (UPDATE 0 dòng) → trả SENT, không RETRY/FAILED', async (_n, failure, final) => {
    const { svc, executeRaw, findUnique } = setup({ sendTemplate: jest.fn().mockResolvedValue(failure) });
    executeRaw.mockResolvedValue(0);
    // Lần đọc đầu là của claimUnderDedupeLock (log còn PENDING); lần sau, khi UPDATE trúng 0 dòng, thấy SENT.
    findUnique.mockResolvedValueOnce({ status: 'PENDING', payload: { data: {} } }).mockResolvedValueOnce({ status: 'SENT' });
    expect(await svc.deliverZns(JOB, final)).toBe('SENT');
  });

  it('UPDATE 0 dòng mà log đã SENT: logger.warn kèm logId và lỗi Zalo của lượt này (không thành lỗi im lặng)', async () => {
    const failure = { ok: false, retryable: true, code: -124, reason: 'token expired' };
    const { svc, executeRaw, findUnique } = setup({ sendTemplate: jest.fn().mockResolvedValue(failure) });
    executeRaw.mockResolvedValue(0);
    findUnique.mockResolvedValueOnce({ status: 'PENDING', payload: { data: {} } }).mockResolvedValueOnce({ status: 'SENT' });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      expect(await svc.deliverZns(JOB, false)).toBe('SENT');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('log-2'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('token expired'));
    } finally {
      warn.mockRestore();
    }
  });

  it('ghi RETRYING chỉ từ PENDING/RETRYING (không mở lại log FAILED đã đóng); ghi FAILED từ mọi trạng thái trừ SENT', async () => {
    const failure = { ok: false, retryable: true, code: -124, reason: 'x' };
    const { svc, executeRaw } = setup({ sendTemplate: jest.fn().mockResolvedValue(failure) });
    await svc.deliverZns(JOB, false);
    expect(sqlOf(executeRaw)).toMatch(/status IN \('PENDING', 'RETRYING'\)/);
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
    const { svc, sendTemplate, executeRaw } = setup({ status: 'FAILED', payload: { data: {} } });
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(sqlOf(executeRaw)).toMatch(/SET status = 'SENT'/);
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
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id && (!where.status || r.status === where.status));
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      }),
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

  it('R-181: worker đã nhận log trước khi catch chạy (count 0) → không nhả khoá, không ném, log giữ nguyên khoá gốc', async () => {
    const m = memorySetup();
    (m.add as jest.Mock).mockImplementationOnce(async () => {
      m.rows.find((r) => r.channel === 'ZNS')!.status = 'RETRYING';
      throw new Error('quá hạn');
    });
    await expect(m.svc.notify('u1', 'ORDER_CONFIRMED', {}, KEY)).resolves.toBeUndefined();
    expect(m.znsRows()).toHaveLength(1);
    expect(m.znsRows()[0]).toMatchObject({ status: 'RETRYING' });
    expect(m.znsRows()[0]!.payload.dedupeKey).toBe(KEY.dedupeKey);
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

describe('NotificationsService.deliverZns: hai log cùng dedupeKey chạy song song (L3-06)', () => {
  const MINE = { id: 'log-2', userId: 'u1', status: 'PENDING', payload: { data: {}, dedupeKey: 'k1' } };

  /** `others`: các log khác cùng khoá mà câu truy vấn trong khoá advisory trả về. */
  function withDedupe(others: { id: string; status: string }[], payload: unknown = MINE.payload) {
    const s = setup({ payload });
    const log = (s.svc as unknown as { prisma: { notificationLog: Record<string, jest.Mock> } }).prisma.notificationLog;
    log.findUnique = jest.fn().mockResolvedValue({ ...MINE, payload });
    const findMany = jest.fn().mockResolvedValue(others);
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw, notificationLog: { findMany, updateMany: txUpdateMany } };
    const prisma = (s.svc as unknown as { prisma: Record<string, unknown> }).prisma;
    prisma.$transaction = jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
    return { ...s, findMany, txUpdateMany, executeRaw };
  }

  it('log cùng khoá đã SENT: bỏ qua, không gọi Zalo, đóng log này', async () => {
    const { svc, sendTemplate, txUpdateMany, findMany, executeRaw } = withDedupe([{ id: 'log-1', status: 'SENT' }]);
    expect(await svc.deliverZns(JOB, false)).toBe('SKIPPED');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', channel: 'ZNS', id: { not: 'log-2' }, payload: { path: ['dedupeKey'], equals: 'k1' }, status: { in: ['SENT', 'RETRYING'] } },
      select: { id: true, status: true },
    });
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { id: 'log-2', status: { in: ['PENDING', 'RETRYING'] } },
      data: { status: 'FAILED', error: expect.stringContaining('log-1'), payload: { data: {}, dedupeKey: 'k1:failed:log-2' } },
    });
  });

  it('log cùng khoá đang gửi/thử lại (RETRYING): hoãn, không đóng, không gọi Zalo, trả RETRY để BullMQ thử lại sau', async () => {
    const { svc, sendTemplate, txUpdateMany } = withDedupe([{ id: 'log-1', status: 'RETRYING' }]);
    expect(await svc.deliverZns(JOB, false)).toBe('RETRY');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(txUpdateMany).not.toHaveBeenCalled();
  });

  it('hoãn tới lượt cuối mà log kia vẫn đang thử lại: đóng FAILED có lý do, không gọi Zalo (không gửi đôi)', async () => {
    const { svc, sendTemplate, txUpdateMany } = withDedupe([{ id: 'log-1', status: 'RETRYING' }]);
    expect(await svc.deliverZns(JOB, true)).toBe('FAILED');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { id: 'log-2', status: { in: ['PENDING', 'RETRYING'] } },
      data: { status: 'FAILED', error: expect.stringContaining('log-1'), payload: { data: {}, dedupeKey: 'k1:failed:log-2' } },
    });
  });

  it('log kia đã FAILED hẳn (không còn SENT/RETRYING): log này nhận quyền ngay trong khoá rồi gửi', async () => {
    const { svc, sendTemplate, txUpdateMany } = withDedupe([]);
    expect(await svc.deliverZns(JOB, false)).toBe('SENT');
    expect(txUpdateMany).toHaveBeenCalledWith({ where: { id: 'log-2', status: { in: ['PENDING', 'RETRYING'] } }, data: { status: 'RETRYING' } });
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('dedupeWithinMs trong payload: chỉ log nằm trong cửa sổ thời gian mới tính (log SENT cũ hơn cửa sổ không chặn)', async () => {
    const now = Date.now();
    const { svc, findMany } = withDedupe([], { data: {}, dedupeKey: 'k1', dedupeWithinMs: 3_600_000 });
    await svc.deliverZns(JOB, false);
    const where = findMany.mock.calls[0][0].where;
    expect(where.sentAt.gte.getTime()).toBeGreaterThanOrEqual(now - 3_600_000 - 50);
    expect(where.sentAt.gte.getTime()).toBeLessThanOrEqual(Date.now() - 3_600_000 + 50);
  });

  it('log không mang dedupeKey: không mở transaction, đi đường nhận log như cũ', async () => {
    const s = setup({ payload: { data: {} } });
    const prisma = (s.svc as unknown as { prisma: Record<string, unknown> }).prisma;
    prisma.$transaction = jest.fn();
    expect(await s.svc.deliverZns(JOB, false)).toBe('SENT');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.notify: ghi dedupeWithinMs vào log ZNS để lúc gửi xét đúng cửa sổ', () => {
  it('retryZns + dedupeWithinMs → payload log ZNS mang dedupeWithinMs', async () => {
    const { svc, create } = setup();
    (svc as unknown as { prisma: { notificationLog: Record<string, jest.Mock> } }).prisma.notificationLog.findFirst = jest.fn().mockResolvedValue(null);
    (svc as unknown as { prisma: Record<string, unknown> }).prisma.$transaction = jest.fn(async (fn: (t: unknown) => unknown) =>
      fn({ $executeRaw: jest.fn(), notificationLog: { findFirst: jest.fn().mockResolvedValue(null), create } }),
    );
    await svc.notify('u1', 'ORDER_CONFIRMED', {}, { dedupeKey: 'k9', dedupeWithinMs: 60_000, retryZns: true });
    const znsCall = create.mock.calls.find((c) => c[0].data.channel === 'ZNS');
    expect(znsCall?.[0].data.payload).toEqual({ data: {}, dedupeKey: 'k9', dedupeWithinMs: 60_000 });
  });
});
