import { DealerBackorderService } from './dealer-backorder.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';

/**
 * Đối soát đơn đại lý đặt trước: mỗi chu kỳ tồn kho có thể tăng (Pancake sync / nhập hàng), job
 * này lấp dần các dòng còn thiếu — FIFO theo đơn cũ trước, và chỉ đẩy Pancake khi đơn đã ĐỦ
 * 100% hàng (trước đó kho vật lý chưa đủ để soạn/xuất).
 */
function makeItem(over: Record<string, unknown> = {}) {
  return { id: 'i1', orderId: 'o1', variationId: 'v1', backorderedQty: 4, ...over };
}

function setup(items: unknown[], opts: { reserved?: Record<string, number>; updateManyCount?: number } = {}) {
  const findMany = jest.fn().mockResolvedValue(items);
  // reserveAvailableVariationStock đi qua $queryRaw — trả "reserved" theo variationId, mặc định
  // giữ đủ toàn bộ số yêu cầu (opts.reserved override từng variation nếu cần mô phỏng thiếu hàng).
  const queryRaw = jest.fn(async (_strings: unknown, ...vals: unknown[]) => {
    const variationId = vals.find((v) => typeof v === 'string') as string | undefined;
    const desired = vals.find((v) => typeof v === 'number') as number | undefined;
    const cap = opts.reserved?.[variationId ?? ''] ?? desired ?? 0;
    return [{ reserved: Math.min(cap, desired ?? 0) }];
  });
  const orderItemUpdateMany = jest.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 });
  const orderItemCount = jest.fn().mockResolvedValue(0); // mặc định: hết backorder sau khi lấp
  const orderFindUnique = jest.fn().mockResolvedValue({ pancakeOrderId: null });
  const executeRaw = jest.fn().mockResolvedValue(1); // releaseVariationStock khi thua race
  const prisma = {
    orderItem: { findMany, updateMany: orderItemUpdateMany, count: orderItemCount },
    order: { findUnique: orderFindUnique },
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
  } as unknown as PrismaService;
  const enqueuePush = jest.fn().mockResolvedValue(undefined);
  const pancakeOrder = { enqueuePush } as unknown as PancakeOrderService;
  return { svc: new DealerBackorderService(prisma, pancakeOrder), findMany, queryRaw, orderItemUpdateMany, orderItemCount, orderFindUnique, executeRaw, enqueuePush };
}

describe('DealerBackorderService.reconcile', () => {
  it('không có dòng nào đang thiếu hàng → không làm gì', async () => {
    const { svc, queryRaw } = setup([]);
    await expect(svc.reconcile()).resolves.toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('quét OrderItem còn backorderedQty > 0, đơn CHƯA huỷ/trả, FIFO theo order.createdAt', async () => {
    const { svc, findMany } = setup([]);
    await svc.reconcile();
    const where = findMany.mock.calls[0]![0].where;
    expect(where.backorderedQty).toEqual({ gt: 0 });
    expect(where.order.status.notIn).toEqual(['CANCELLED', 'RETURNED']);
    expect(findMany.mock.calls[0]![0].orderBy).toEqual({ order: { createdAt: 'asc' } });
  });

  it('đủ hàng → lấp hết, ghi backorderedQty=0, đẩy Pancake vì đơn đã đủ 100%', async () => {
    const { svc, orderItemUpdateMany, enqueuePush } = setup([makeItem({ backorderedQty: 4 })]);
    const filled = await svc.reconcile();
    expect(filled).toBe(4);
    expect(orderItemUpdateMany).toHaveBeenCalledWith({
      where: { id: 'i1', backorderedQty: 4 },
      data: { backorderedQty: 0 },
    });
    expect(enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('chỉ có MỘT PHẦN hàng → lấp được bấy nhiêu, KHÔNG đẩy Pancake (đơn còn thiếu)', async () => {
    const { svc, orderItemUpdateMany, orderItemCount, enqueuePush } = setup(
      [makeItem({ backorderedQty: 4 })],
      { reserved: { v1: 1 } }, // kho chỉ về 1
    );
    orderItemCount.mockResolvedValue(1); // vẫn còn dòng khác backorder (chính dòng này còn 3)
    const filled = await svc.reconcile();
    expect(filled).toBe(1);
    expect(orderItemUpdateMany).toHaveBeenCalledWith({
      where: { id: 'i1', backorderedQty: 4 },
      data: { backorderedQty: 3 },
    });
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('vẫn hết sạch hàng (reserved=0) → bỏ qua dòng này, không ghi gì, không đẩy Pancake', async () => {
    const { svc, orderItemUpdateMany, enqueuePush } = setup([makeItem()], { reserved: { v1: 0 } });
    const filled = await svc.reconcile();
    expect(filled).toBe(0);
    expect(orderItemUpdateMany).not.toHaveBeenCalled();
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('2 lượt reconcile chồng nhau: updateMany thua race → trả lại phần vừa giữ (không mất tồn kho vào hư không)', async () => {
    const { svc, executeRaw, enqueuePush } = setup([makeItem({ backorderedQty: 4 })], { updateManyCount: 0 });
    const filled = await svc.reconcile();
    expect(filled).toBe(0); // không tính là đã lấp vì bị lượt khác ghi trước
    expect(executeRaw).toHaveBeenCalledTimes(1); // releaseVariationStock hoàn lại 4 đơn vị vừa giữ
    expect(executeRaw.mock.calls[0]!.slice(1)).toEqual([4, 4, 'v1']);
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('đơn có nhiều dòng, chỉ 1 dòng vừa hết backorder → KHÔNG đẩy Pancake (dòng kia vẫn thiếu)', async () => {
    const { svc, orderItemCount, enqueuePush } = setup([
      makeItem({ id: 'i1', variationId: 'v1', backorderedQty: 4 }),
      makeItem({ id: 'i2', variationId: 'v2', backorderedQty: 2 }),
    ], { reserved: { v1: 4, v2: 0 } });
    orderItemCount.mockResolvedValue(1); // dòng i2 vẫn còn backorder
    await svc.reconcile();
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('đơn đã có pancakeOrderId (đã đẩy trước đó) → không đẩy lại', async () => {
    const { svc, orderFindUnique, enqueuePush } = setup([makeItem({ backorderedQty: 4 })]);
    orderFindUnique.mockResolvedValue({ pancakeOrderId: 'pk-1' });
    await svc.reconcile();
    expect(enqueuePush).not.toHaveBeenCalled();
  });

  it('enqueuePush lỗi không được ném ra ngoài (non-fatal, mirror DealerService)', async () => {
    const { svc, enqueuePush } = setup([makeItem({ backorderedQty: 4 })]);
    enqueuePush.mockRejectedValue(new Error('redis down'));
    await expect(svc.reconcile()).resolves.toBe(4);
  });

  it('không có PancakeOrderService (chưa wiring) → không throw', async () => {
    const findMany = jest.fn().mockResolvedValue([makeItem({ backorderedQty: 4 })]);
    const queryRaw = jest.fn().mockResolvedValue([{ reserved: 4 }]);
    const prisma = {
      orderItem: { findMany, updateMany: jest.fn().mockResolvedValue({ count: 1 }), count: jest.fn().mockResolvedValue(0) },
      order: { findUnique: jest.fn().mockResolvedValue({ pancakeOrderId: null }) },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const svc = new DealerBackorderService(prisma, undefined);
    await expect(svc.reconcile()).resolves.toBe(4);
  });
});
