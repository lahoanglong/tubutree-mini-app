import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NotificationsService, INAPP_RETRY_JOB, INAPP_RETRY_JOB_OPTIONS, type InAppRetryJobData } from './notifications.service';
import { InAppRetryProcessor, NotificationsProcessor } from './notifications.processor';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

jest.mock('../../config/sentry', () => ({ captureServerError: jest.fn() }));
const { captureServerError } = require('../../config/sentry') as { captureServerError: jest.Mock };

const KEY = 'invoice-issued:o1';

function setup(opts: { add?: jest.Mock | null } = {}) {
  const prisma = {} as PrismaService;
  const analytics = { recordBestEffort: jest.fn() } as unknown as AnalyticsEventsService;
  const add = opts.add === undefined ? jest.fn().mockResolvedValue({}) : opts.add;
  const znsAdd = jest.fn().mockResolvedValue({});
  // Hàng ZNS (tham số thứ 4) tách khỏi hàng thử lại tin trong app (tham số thứ 6): job thử lại không được vào hàng ZNS.
  const svc = new NotificationsService(prisma, {} as ZnsClient, analytics, { add: znsAdd } as never, undefined, add ? ({ add } as never) : undefined);
  const notify = jest.spyOn(svc, 'notify');
  const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  return { svc, notify, add, znsAdd, error, warn };
}

afterEach(() => {
  jest.restoreAllMocks();
  captureServerError.mockClear();
});

describe('NotificationsService.notifyWithRetry: tin phụ sau thao tác đã xong không được mất im lặng', () => {
  it('gửi được ngay → SENT, gọi notify với dedupeKey, không xếp hàng', async () => {
    const { svc, notify, add } = setup();
    notify.mockResolvedValue(undefined);
    await expect(svc.notifyWithRetry('u1', 'INVOICE_ISSUED', { order_code: 'T1' }, { dedupeKey: KEY }, 'order=T1')).resolves.toBe('SENT');
    expect(notify).toHaveBeenCalledWith('u1', 'INVOICE_ISSUED', { order_code: 'T1' }, { dedupeKey: KEY });
    expect(add).not.toHaveBeenCalled();
  });

  it('lỗi tạm thời (DB chập chờn) → xếp job thử lại cùng dedupeKey, không ném, ghi warn', async () => {
    const { svc, notify, add, znsAdd, warn } = setup();
    notify.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    await expect(svc.notifyWithRetry('u1', 'INVOICE_ISSUED', { order_code: 'T1' }, { dedupeKey: KEY }, 'order=T1')).resolves.toBe('QUEUED');
    expect(add).toHaveBeenCalledWith(
      INAPP_RETRY_JOB,
      { userId: 'u1', templateCode: 'INVOICE_ISSUED', data: { order_code: 'T1' }, dedupeKey: KEY, context: 'order=T1' },
      INAPP_RETRY_JOB_OPTIONS,
    );
    expect(znsAdd).not.toHaveBeenCalled();
    expect(INAPP_RETRY_JOB_OPTIONS.attempts).toBeGreaterThanOrEqual(5);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('order=T1'));
    expect(captureServerError).not.toHaveBeenCalled();
  });

  it('xếp hàng cũng lỗi (Redis) → LOST: ghi error kèm ngữ cảnh và báo Sentry, vẫn không ném', async () => {
    const { svc, notify, error } = setup({ add: jest.fn().mockRejectedValue(new Error('redis down')) });
    notify.mockRejectedValue(new Error('db down'));
    await expect(svc.notifyWithRetry('u1', 'INVOICE_ISSUED', { order_code: 'T1' }, { dedupeKey: KEY }, 'order=T1')).resolves.toBe('LOST');
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/INVOICE_ISSUED.*order=T1.*db down/));
    expect(captureServerError).toHaveBeenCalledTimes(1);
  });

  it('không có hàng đợi (khởi tạo trực tiếp) → LOST, ghi error và báo Sentry', async () => {
    const { svc, notify, error } = setup({ add: null });
    notify.mockRejectedValue(new Error('db down'));
    await expect(svc.notifyWithRetry('u1', 'INVOICE_ISSUED', { order_code: 'T1' }, { dedupeKey: KEY })).resolves.toBe('LOST');
    expect(error).toHaveBeenCalled();
    expect(captureServerError).toHaveBeenCalledTimes(1);
  });
});

describe('InAppRetryProcessor: hàng riêng của job inapp-retry', () => {
  it('xử lý job bằng notify cùng dedupeKey, ném khi lỗi để BullMQ thử lại', async () => {
    const notify = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('db down'));
    const processor = new InAppRetryProcessor({ notify } as unknown as NotificationsService);
    const data: InAppRetryJobData = { userId: 'u1', templateCode: 'INVOICE_ISSUED', data: {}, dedupeKey: KEY };
    const job = { name: INAPP_RETRY_JOB, data, opts: { attempts: 6 }, attemptsMade: 0 } as unknown as Job<InAppRetryJobData>;
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith('u1', 'INVOICE_ISSUED', {}, { dedupeKey: KEY });
    await expect(processor.process(job)).rejects.toThrow('db down');
  });
});

describe('NotificationsProcessor: job inapp-retry cũ còn nằm trong hàng notifications lúc deploy', () => {
  const DATA: InAppRetryJobData = { userId: 'u1', templateCode: 'INVOICE_ISSUED', data: { order_code: 'T1' }, dedupeKey: KEY, context: 'order=T1' };

  function run(notifyImpl: jest.Mock, attemptsMade = 0) {
    const notifications = { notify: notifyImpl, quietDelayMs: jest.fn().mockResolvedValue(3_600_000), deliverZns: jest.fn() };
    const processor = new NotificationsProcessor(notifications as unknown as NotificationsService);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job = { name: INAPP_RETRY_JOB, data: DATA, opts: { attempts: 6 }, attemptsMade, moveToDelayed: jest.fn() };
    return { result: processor.process(job as unknown as Job<InAppRetryJobData>), notifications, error, job };
  }

  it('gửi lại bằng notify cùng dedupeKey (lượt trước đã ghi thì notify tự bỏ qua); không dời theo giờ yên tĩnh ZNS', async () => {
    const { result, notifications, job } = run(jest.fn().mockResolvedValue(undefined));
    await expect(result).resolves.toBeUndefined();
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'INVOICE_ISSUED', { order_code: 'T1' }, { dedupeKey: KEY });
    expect(notifications.quietDelayMs).not.toHaveBeenCalled();
    expect(notifications.deliverZns).not.toHaveBeenCalled();
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  it('còn lượt → ném để BullMQ thử lại, chưa ghi error', async () => {
    const { result, error } = run(jest.fn().mockRejectedValue(new Error('db down')), 0);
    await expect(result).rejects.toThrow('db down');
    expect(error).not.toHaveBeenCalled();
  });

  it('lượt cuối vẫn lỗi → ghi error THẤT BẠI kèm ngữ cảnh và báo Sentry', async () => {
    const { result, error } = run(jest.fn().mockRejectedValue(new Error('db down')), 5);
    await expect(result).rejects.toThrow('db down');
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/INVOICE_ISSUED.*order=T1.*THẤT BẠI sau 6 lượt/));
    expect(captureServerError).toHaveBeenCalledTimes(1);
  });
});
