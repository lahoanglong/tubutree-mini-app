import { PancakeOrderService } from './pancake-order.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    code: 'TUBU1',
    pancakeOrderId: null,
    shippingAddress: {
      recipient: 'A', phone: '0900', street: 'S', ward: 'W', district: 'D', province: 'P',
      provinceCode: '1', districtCode: '2', wardCode: '3',
    },
    invoiceRequest: null,
    items: [{ variationId: 'v1', quantity: 2 }],
    shippingFee: 0,
    discount: 0,
    type: 'RETAIL',
    user: { zaloId: 'z1' },
    ...overrides,
  };
}

describe('PancakeOrderService.pushOrder', () => {
  it('đơn đã có pancakeOrderId → trả về luôn, KHÔNG gọi client', async () => {
    const order = makeOrder({ pancakeOrderId: 'pk-existing' });
    const prisma = { order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order), update: jest.fn() } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(true), createOrder: jest.fn() } as unknown as PancakeClient;
    const svc = new PancakeOrderService(prisma, client, { add: jest.fn() } as never);
    const res = await svc.pushOrder('o1');
    expect(res).toBe('pk-existing');
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('Pancake chưa cấu hình → trả null, không throw, không update', async () => {
    const order = makeOrder();
    const prisma = { order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order), update: jest.fn() } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(false), createOrder: jest.fn() } as unknown as PancakeClient;
    const svc = new PancakeOrderService(prisma, client, { add: jest.fn() } as never);
    const res = await svc.pushOrder('o1');
    expect(res).toBeNull();
    expect((prisma.order.update as jest.Mock)).not.toHaveBeenCalled();
  });

  it('tạo đơn thành công → lưu pancakeOrderId', async () => {
    const order = makeOrder();
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order), update },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', pancakeId: 'pv1' }]) },
    } as unknown as PrismaService;
    const client = {
      isConfigured: jest.fn().mockReturnValue(true),
      createOrder: jest.fn().mockResolvedValue({ id: 'pk-new' }),
    } as unknown as PancakeClient;
    const svc = new PancakeOrderService(prisma, client, { add: jest.fn() } as never);
    const res = await svc.pushOrder('o1');
    expect(res).toBe('pk-new');
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { pancakeOrderId: 'pk-new' } });
  });

  it('Pancake trả lỗi (client.createOrder throw) → ném tiếp, KHÔNG nuốt lỗi', async () => {
    const order = makeOrder();
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order), update: jest.fn() },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const client = {
      isConfigured: jest.fn().mockReturnValue(true),
      createOrder: jest.fn().mockRejectedValue(new Error('Pancake 500')),
    } as unknown as PancakeClient;
    const svc = new PancakeOrderService(prisma, client, { add: jest.fn() } as never);
    await expect(svc.pushOrder('o1')).rejects.toThrow('Pancake 500');
  });
});

describe('PancakeOrderService.enqueuePush', () => {
  it('add job vào queue với jobId=orderId (dedupe cùng đơn)', async () => {
    const add = jest.fn().mockResolvedValue({});
    const remove = jest.fn().mockResolvedValue(1);
    const prisma = {} as unknown as PrismaService;
    const client = {} as unknown as PancakeClient;
    const svc = new PancakeOrderService(prisma, client, { add, remove } as never);
    await svc.enqueuePush('o1');
    expect(add).toHaveBeenCalledWith('push', { orderId: 'o1' }, { jobId: 'o1' });
  });

  /**
   * BullMQ giữ job hash lại sau khi job xong/thất bại (removeOnComplete 1000, removeOnFail
   * 5000). Script addStandardJob trả về job cũ mà KHÔNG enqueue nếu hash cùng jobId còn tồn
   * tại. Nghĩa là đơn đã đẩy hỏng hết 5 lần thử thì cron cứu hộ 15 phút/lần gọi enqueuePush
   * mãi mãi mà không có gì chạy — đơn đã trừ kho, đã thu tiền, không bao giờ tới kho vật lý.
   * remove() là no-op với job đang chạy (script removeJob bỏ qua job bị khoá) nên vẫn giữ
   * đúng tác dụng chống đẩy đôi khi job cũ còn active.
   */
  it('xoá job cũ trước khi add — nếu không, job đã thất bại chặn mọi lần enqueue sau', async () => {
    const calls: string[] = [];
    const add = jest.fn().mockImplementation(() => { calls.push('add'); return Promise.resolve({}); });
    const remove = jest.fn().mockImplementation(() => { calls.push('remove'); return Promise.resolve(1); });
    const svc = new PancakeOrderService({} as unknown as PrismaService, {} as unknown as PancakeClient, { add, remove } as never);

    await svc.enqueuePush('o1');

    expect(remove).toHaveBeenCalledWith('o1');
    expect(calls).toEqual(['remove', 'add']);
  });

  it('remove lỗi (job đang chạy/redis chớp) → vẫn add, không ném ra ngoài', async () => {
    const add = jest.fn().mockResolvedValue({});
    const remove = jest.fn().mockRejectedValue(new Error('locked'));
    const svc = new PancakeOrderService({} as unknown as PrismaService, {} as unknown as PancakeClient, { add, remove } as never);

    await expect(svc.enqueuePush('o1')).resolves.toBeUndefined();
    expect(add).toHaveBeenCalled();
  });
});
