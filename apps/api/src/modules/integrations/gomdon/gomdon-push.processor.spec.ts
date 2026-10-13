import { UnrecoverableError, type Job } from 'bullmq';
import { GomdonPushProcessor } from './gomdon-push.processor';
import type { GomdonOrderService } from './gomdon-order.service';
import { GomdonRejectedError } from './gomdon.errors';

function job(name: string, attemptsMade: number, attempts = 5) {
  return { name, data: { orderId: 'o1' }, opts: { attempts }, attemptsMade } as unknown as Job<{ orderId: string }>;
}

describe('GomdonPushProcessor', () => {
  let gomdonOrder: {
    pushOrder: jest.Mock;
    markFinalPushFailure: jest.Mock;
    cancelOnGomdon: jest.Mock;
  };
  let processor: GomdonPushProcessor;

  beforeEach(() => {
    gomdonOrder = {
      pushOrder: jest.fn().mockResolvedValue('BE1'),
      markFinalPushFailure: jest.fn().mockResolvedValue(undefined),
      cancelOnGomdon: jest.fn().mockResolvedValue(undefined),
    };
    processor = new GomdonPushProcessor(gomdonOrder as unknown as GomdonOrderService);
  });

  it('job push thành công → không fail-safe', async () => {
    await processor.process(job('push', 0));
    expect(gomdonOrder.pushOrder).toHaveBeenCalledWith('o1');
    expect(gomdonOrder.markFinalPushFailure).not.toHaveBeenCalled();
  });

  it('lỗi ở lần chưa phải cuối → ném để BullMQ retry, chưa fail-safe', async () => {
    gomdonOrder.pushOrder.mockRejectedValueOnce(new Error('Gomdon 400'));
    await expect(processor.process(job('push', 1))).rejects.toThrow('Gomdon 400');
    expect(gomdonOrder.markFinalPushFailure).not.toHaveBeenCalled();
  });

  it('lỗi ở lần cuối → fail-safe markFinalPushFailure (FAILED + Pancake + báo CSKH)', async () => {
    const err = new Error('Gomdon 400');
    gomdonOrder.pushOrder.mockRejectedValueOnce(err);
    await expect(processor.process(job('push', 4))).resolves.toBeUndefined();
    expect(gomdonOrder.markFinalPushFailure).toHaveBeenCalledWith('o1', err);
  });

  it('fail-safe chính nó lỗi (DB down) → NÉM để job kết thúc failed (không kẹt ở completed)', async () => {
    gomdonOrder.pushOrder.mockRejectedValueOnce(new Error('db down'));
    gomdonOrder.markFinalPushFailure.mockRejectedValueOnce(new Error('db down'));
    await expect(processor.process(job('push', 4))).rejects.toThrow('db down');
  });

  it('UnrecoverableError (đã tạo vận đơn mà không ghi được DB) → ném thẳng, KHÔNG fail-safe "tạo tay"', async () => {
    gomdonOrder.pushOrder.mockRejectedValueOnce(new UnrecoverableError('không ghi được mã'));
    await expect(processor.process(job('push', 4))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(gomdonOrder.markFinalPushFailure).not.toHaveBeenCalled();
  });

  it('job cancel → cancelOnGomdon với cờ lần cuối', async () => {
    await processor.process(job('cancel', 0));
    expect(gomdonOrder.cancelOnGomdon).toHaveBeenCalledWith('o1', false);
    await processor.process(job('cancel', 4));
    expect(gomdonOrder.cancelOnGomdon).toHaveBeenLastCalledWith('o1', true);
    expect(gomdonOrder.pushOrder).not.toHaveBeenCalled();
  });
  it('UAT GOMDON-1: Gomdon từ chối DỨT KHOÁT (lỗi dữ liệu) → không chờ hết 8 lần, chốt sau vài lần', async () => {
    const err = new GomdonRejectedError('The source province field is required.');
    gomdonOrder.pushOrder.mockRejectedValue(err);
    await expect(processor.process(job('push', 1, 8))).rejects.toBe(err);
    await expect(processor.process(job('push', 2, 8))).resolves.toBeUndefined();
    expect(gomdonOrder.markFinalPushFailure).toHaveBeenCalledWith('o1', err);
  });

  it('UAT GOMDON-1: lỗi TẠM (503/mạng/đăng nhập) → thử đủ số lần của job rồi mới fail-safe', async () => {
    const err = new GomdonRejectedError('HTTP 503', { transient: true });
    gomdonOrder.pushOrder.mockRejectedValue(err);
    await expect(processor.process(job('push', 2, 8))).rejects.toBe(err);
    await expect(processor.process(job('push', 6, 8))).rejects.toBe(err);
    expect(gomdonOrder.markFinalPushFailure).not.toHaveBeenCalled();
    await processor.process(job('push', 7, 8));
    expect(gomdonOrder.markFinalPushFailure).toHaveBeenCalledWith('o1', err);
  });
});
