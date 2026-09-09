import { PancakePushProcessor } from './pancake-push.processor';
import type { PancakeOrderService } from './pancake-order.service';

function makeJob(orderId: string, attemptsMade: number, attempts: number) {
  return { data: { orderId }, attemptsMade, opts: { attempts } } as never;
}

describe('PancakePushProcessor', () => {
  it('gọi pancakeOrder.pushOrder với orderId của job', async () => {
    const pushOrder = jest.fn().mockResolvedValue('pk1');
    const proc = new PancakePushProcessor({ pushOrder } as unknown as PancakeOrderService);
    await proc.process(makeJob('o1', 0, 5));
    expect(pushOrder).toHaveBeenCalledWith('o1');
  });

  it('pushOrder throw ở lần thử KHÔNG PHẢI cuối → ném tiếp cho BullMQ retry, không nuốt lỗi', async () => {
    const pushOrder = jest.fn().mockRejectedValue(new Error('Pancake 500'));
    const proc = new PancakePushProcessor({ pushOrder } as unknown as PancakeOrderService);
    await expect(proc.process(makeJob('o1', 0, 5))).rejects.toThrow('Pancake 500');
  });

  it('pushOrder throw ở lần thử CUỐI → vẫn ném tiếp (để BullMQ đánh dấu failed)', async () => {
    const pushOrder = jest.fn().mockRejectedValue(new Error('Pancake 500'));
    const proc = new PancakePushProcessor({ pushOrder } as unknown as PancakeOrderService);
    await expect(proc.process(makeJob('o1', 4, 5))).rejects.toThrow('Pancake 500');
  });
});
