import { Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import { NotificationsProcessor } from './notifications.processor';
import { znsQuietDelayMs, type NotificationsService, type ZnsDeliveryOutcome, type ZnsSendJobData } from './notifications.service';

const DATA: ZnsSendJobData = { notificationLogId: 'log-1', phone: '0900000000', templateId: 'zt-1', templateData: {} };

function run(outcome: ZnsDeliveryOutcome) {
  const notifications = { deliverZns: jest.fn().mockResolvedValue(outcome), quietDelayMs: jest.fn().mockResolvedValue(0) } as unknown as NotificationsService;
  const processor = new NotificationsProcessor(notifications);
  const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const result = processor.process({ data: DATA, opts: { attempts: 6 }, attemptsMade: 0 } as unknown as Job<ZnsSendJobData>);
  return { result, error, warn };
}

afterEach(() => jest.restoreAllMocks());

describe('NotificationsProcessor', () => {
  it('SKIPPED (job đến muộn sau khi khoá đã nhả) → ghi warn, không ghi error và không ném', async () => {
    const { result, error, warn } = run('SKIPPED');
    await expect(result).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('log-1'));
    expect(error).not.toHaveBeenCalled();
  });

  it('FAILED → ghi error, không ném (job kết thúc)', async () => {
    const { result, error } = run('FAILED');
    await expect(result).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('THẤT BẠI'));
  });

  it('RETRY → ném để BullMQ xếp lịch thử lại', async () => {
    await expect(run('RETRY').result).rejects.toThrow('thất bại tạm thời');
  });

  it('SENT → không ghi gì, không ném', async () => {
    const { result, error, warn } = run('SENT');
    await expect(result).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('NotificationsProcessor: lượt thử lại không gửi trong giờ yên tĩnh (OPS-03)', () => {
  const START = new Date('2026-10-31T13:59:00.000Z'); // 20:59 giờ VN
  beforeEach(() => jest.useFakeTimers().setSystemTime(START));
  afterEach(() => jest.useRealTimers());

  it('lượt thử lại rơi vào 21:01 → dời tới 08:00, ném DelayedError, không gọi Zalo', async () => {
    jest.setSystemTime(new Date('2026-10-31T14:01:30.000Z')); // 21:01:30 giờ VN
    const eightAm = new Date('2026-11-01T01:00:00.000Z').getTime();
    const deliverZns = jest.fn();
    const notifications = {
      deliverZns,
      quietDelayMs: jest.fn(async () => znsQuietDelayMs(new Date(), 21, 8)),
    } as unknown as NotificationsService;
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    const job = { data: DATA, opts: { attempts: 6 }, attemptsMade: 1, moveToDelayed } as unknown as Job<ZnsSendJobData>;
    await expect(new NotificationsProcessor(notifications).process(job, 'tok')).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(eightAm, 'tok');
    expect(deliverZns).not.toHaveBeenCalled();
  });

  it('đang trong giờ gửi (20:59) → gửi bình thường, không dời', async () => {
    const deliverZns = jest.fn().mockResolvedValue('SENT');
    const notifications = { deliverZns, quietDelayMs: jest.fn(async () => znsQuietDelayMs(new Date(), 21, 8)) } as unknown as NotificationsService;
    const moveToDelayed = jest.fn();
    const job = { data: DATA, opts: { attempts: 6 }, attemptsMade: 0, moveToDelayed } as unknown as Job<ZnsSendJobData>;
    await expect(new NotificationsProcessor(notifications).process(job, 'tok')).resolves.toBeUndefined();
    expect(moveToDelayed).not.toHaveBeenCalled();
    expect(deliverZns).toHaveBeenCalledWith(DATA, false);
  });
});
