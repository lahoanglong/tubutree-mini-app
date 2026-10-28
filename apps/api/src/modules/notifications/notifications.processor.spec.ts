import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NotificationsProcessor } from './notifications.processor';
import type { NotificationsService, ZnsDeliveryOutcome, ZnsSendJobData } from './notifications.service';

const DATA: ZnsSendJobData = { notificationLogId: 'log-1', phone: '0900000000', templateId: 'zt-1', templateData: {} };

function run(outcome: ZnsDeliveryOutcome) {
  const notifications = { deliverZns: jest.fn().mockResolvedValue(outcome) } as unknown as NotificationsService;
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
