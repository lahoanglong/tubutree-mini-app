import { UnrecoverableError } from 'bullmq';
import { PancakePushProcessor } from './pancake-push.processor';
import type { PancakeOrderService } from './pancake-order.service';
import { PancakeOrderDataError } from './pancake-outbound';

function makeJob(orderId: string, attemptsMade: number, attempts: number, name = 'push') {
  return { name, data: { orderId }, attemptsMade, opts: { attempts } } as never;
}

function mk(overrides: Record<string, jest.Mock> = {}) {
  const svc = {
    pushOrder: jest.fn().mockResolvedValue('pk1'),
    markPushFailure: jest.fn().mockResolvedValue(undefined),
    syncPayment: jest.fn().mockResolvedValue(undefined),
    cancelOnPancake: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { svc, proc: new PancakePushProcessor(svc as unknown as PancakeOrderService) };
}

describe('PancakePushProcessor', () => {
  it('job push → pushOrder(orderId)', async () => {
    const { svc, proc } = mk();
    await proc.process(makeJob('o1', 0, 5));
    expect(svc.pushOrder).toHaveBeenCalledWith('o1');
  });

  it('lỗi ở lần KHÔNG phải cuối → ghi lý do (không FAILED) rồi ném tiếp cho BullMQ retry', async () => {
    const { svc, proc } = mk({ pushOrder: jest.fn().mockRejectedValue(new Error('Pancake 500')) });
    await expect(proc.process(makeJob('o1', 0, 5))).rejects.toThrow('Pancake 500');
    expect(svc.markPushFailure).toHaveBeenCalledWith('o1', expect.any(Error), false);
  });

  it('lỗi ở lần CUỐI → chốt FAILED (+ Cần xử lý) rồi vẫn ném để BullMQ đánh dấu failed', async () => {
    const { svc, proc } = mk({ pushOrder: jest.fn().mockRejectedValue(new Error('Pancake 500')) });
    await expect(proc.process(makeJob('o1', 4, 5))).rejects.toThrow('Pancake 500');
    expect(svc.markPushFailure).toHaveBeenCalledWith('o1', expect.any(Error), true);
  });

  it('thiếu dữ liệu người nhận → dừng ngay (UnrecoverableError), báo admin luôn', async () => {
    const { svc, proc } = mk({ pushOrder: jest.fn().mockRejectedValue(new PancakeOrderDataError('thiếu SĐT')) });
    await expect(proc.process(makeJob('o1', 0, 5))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(svc.markPushFailure).toHaveBeenCalledWith('o1', expect.any(PancakeOrderDataError), true);
  });

  it('job cancel / payment → gọi đúng handler kèm cờ lần cuối', async () => {
    const { svc, proc } = mk();
    await proc.process(makeJob('o1', 4, 5, 'cancel'));
    await proc.process(makeJob('o2', 0, 5, 'payment'));
    expect(svc.cancelOnPancake).toHaveBeenCalledWith('o1', true);
    expect(svc.syncPayment).toHaveBeenCalledWith('o2', false);
    expect(svc.pushOrder).not.toHaveBeenCalled();
  });
});
