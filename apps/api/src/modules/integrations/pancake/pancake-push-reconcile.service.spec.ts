import { PancakePushReconcileService } from './pancake-push-reconcile.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { PancakeClient } from './pancake.client';
import type { PancakeOrderService } from './pancake-order.service';

describe('PancakePushReconcileService.reconcile', () => {
  it('Pancake chưa cấu hình → bỏ qua, không query DB', async () => {
    const findMany = jest.fn();
    const prisma = { order: { findMany } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(false) } as unknown as PancakeClient;
    const svc = new PancakePushReconcileService(prisma, client, { enqueuePush: jest.fn() } as unknown as PancakeOrderService);
    await svc.reconcile();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('không có đơn tồn đọng → không gọi enqueuePush', async () => {
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(true) } as unknown as PancakeClient;
    const enqueuePush = jest.fn();
    const svc = new PancakePushReconcileService(prisma, client, { enqueuePush } as unknown as PancakeOrderService);
    await svc.reconcile();
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('tìm đơn pancakeOrderId=null, status khác CANCELLED, cũ hơn 15 phút → re-enqueue từng đơn', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'o1', code: 'TUBU1' }, { id: 'o2', code: 'TUBU2' }]);
    const prisma = { order: { findMany } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(true) } as unknown as PancakeClient;
    const enqueuePush = jest.fn().mockResolvedValue(undefined);
    const svc = new PancakePushReconcileService(prisma, client, { enqueuePush } as unknown as PancakeOrderService);
    await svc.reconcile();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pancakeOrderId: null, status: { notIn: ['CANCELLED'] } }),
        take: PancakePushReconcileService.BATCH_SIZE,
      }),
    );
    expect(enqueuePush).toHaveBeenCalledWith('o1');
    expect(enqueuePush).toHaveBeenCalledWith('o2');
    expect(enqueuePush).toHaveBeenCalledTimes(2);
  });

  it('1 đơn enqueue lỗi → vẫn tiếp tục re-enqueue các đơn còn lại (không dừng cả batch)', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'o1', code: 'TUBU1' }, { id: 'o2', code: 'TUBU2' }]);
    const prisma = { order: { findMany } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(true) } as unknown as PancakeClient;
    const enqueuePush = jest.fn().mockRejectedValueOnce(new Error('redis down')).mockResolvedValueOnce(undefined);
    const svc = new PancakePushReconcileService(prisma, client, { enqueuePush } as unknown as PancakeOrderService);
    await svc.reconcile();
    expect(enqueuePush).toHaveBeenCalledTimes(2);
  });
});
