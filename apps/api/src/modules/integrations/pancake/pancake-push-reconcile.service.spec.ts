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
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', hasRecyclingPickup: false },
      { id: 'o2', code: 'TUBU2', hasRecyclingPickup: false },
    ]);
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

  it('đơn thu gom còn chờ Gomdon (null/CREATING) < 60 phút → KHÔNG đẩy Pancake (GomdonReconcileService lo)', async () => {
    const recent = new Date(Date.now() - 20 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      { id: 'o2', code: 'TUBU2', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'CREATING' },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { order: { findMany, updateMany } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(true) } as unknown as PancakeClient;
    const enqueuePush = jest.fn().mockResolvedValue(undefined);
    await new PancakePushReconcileService(prisma, client, { enqueuePush } as unknown as PancakeOrderService).reconcile();
    expect(enqueuePush).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('đơn thu gom kẹt > 60 phút (vd job Gomdon đã COMPLETED mà không làm gì) → chốt FAILED/NEEDS_MANUAL_CHECK có guard RỒI đẩy Pancake', async () => {
    const old = new Date(Date.now() - 90 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', createdAt: old, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { order: { findMany, updateMany } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(true) } as unknown as PancakeClient;
    const enqueuePush = jest.fn().mockResolvedValue(undefined);
    await new PancakePushReconcileService(prisma, client, { enqueuePush } as unknown as PancakeOrderService).reconcile();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: null },
      data: { gomdonStatus: 'FAILED' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'CREATING' },
      data: { gomdonStatus: 'NEEDS_MANUAL_CHECK' },
    });
    // Chốt trạng thái TRƯỚC khi đẩy Pancake (note Pancake đọc trạng thái đã chốt).
    expect(updateMany.mock.invocationCallOrder[1]).toBeLessThan(enqueuePush.mock.invocationCallOrder[0]!);
    expect(enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('đơn thu gom đã có mã Gomdon / đã chốt FAILED / NOT_CONFIGURED / AWAITING_PAYMENT → đẩy Pancake bình thường', async () => {
    const recent = new Date(Date.now() - 20 * 60_000);
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o2', code: 'TUBU2', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: '1', gomdonPartnerCode: 'GOM123', gomdonStatus: '1' },
      { id: 'o3', code: 'TUBU3', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'FAILED' },
      { id: 'o4', code: 'TUBU4', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'NOT_CONFIGURED' },
      { id: 'o5', code: 'TUBU5', createdAt: recent, hasRecyclingPickup: true, gomdonOrderId: null, gomdonPartnerCode: null, gomdonStatus: 'AWAITING_PAYMENT' },
    ]);
    const updateMany = jest.fn();
    const prisma = { order: { findMany, updateMany } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(true) } as unknown as PancakeClient;
    const enqueuePush = jest.fn().mockResolvedValue(undefined);
    await new PancakePushReconcileService(prisma, client, { enqueuePush } as unknown as PancakeOrderService).reconcile();
    expect(enqueuePush.mock.calls.map((c) => c[0])).toEqual(['o2', 'o3', 'o4', 'o5']);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('1 đơn enqueue lỗi → vẫn tiếp tục re-enqueue các đơn còn lại (không dừng cả batch)', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', hasRecyclingPickup: false },
      { id: 'o2', code: 'TUBU2', hasRecyclingPickup: false },
    ]);
    const prisma = { order: { findMany } } as unknown as PrismaService;
    const client = { isConfigured: jest.fn().mockReturnValue(true) } as unknown as PancakeClient;
    const enqueuePush = jest.fn().mockRejectedValueOnce(new Error('redis down')).mockResolvedValueOnce(undefined);
    const svc = new PancakePushReconcileService(prisma, client, { enqueuePush } as unknown as PancakeOrderService);
    await svc.reconcile();
    expect(enqueuePush).toHaveBeenCalledTimes(2);
  });
});
