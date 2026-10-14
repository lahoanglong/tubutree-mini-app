import { OrderStatusService } from './order-status.service';
import type { OrderReversalService } from './order-reversal.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { PancakeHandedOverError } from '../integrations/pancake/pancake-sync-hooks';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    code: 'TUBU1',
    userId: 'u1',
    type: 'RETAIL',
    status: 'CONFIRMED',
    note: null,
    total: 100000,
    paymentMethod: 'WALLET',
    paymentStatus: 'PAID',
    pancakeOrderId: 'pk-1',
    pancakePushClaimedAt: null,
    items: [{ id: 'i1', variationId: 'v1', quantity: 1, flashSaleItemId: null }],
    ...overrides,
  };
}

function make(order: Record<string, unknown>, hooks: Record<string, jest.Mock> = {}) {
  const tx = {
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const pancakeHooks = {
    precheckCancel: jest.fn().mockResolvedValue({ kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' }),
    afterLocalCancel: jest.fn().mockResolvedValue(undefined),
    afterPaid: jest.fn().mockResolvedValue(undefined),
    ...hooks,
  };
  const svc = new OrderStatusService(
    prisma as unknown as PrismaService,
    { creditOrderPoints: jest.fn().mockResolvedValue(undefined), reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService,
    {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService,
    { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
    { reverseFinancials: jest.fn().mockResolvedValue(undefined) } as unknown as OrderReversalService,
    undefined,
    undefined,
    pancakeHooks as never,
  );
  return { svc, prisma, tx, pancakeHooks };
}

describe('OrderStatusService — huỷ đơn đã lên Pancake (D1: PANCAKE-2, SELLER-3, ADMINOPS-2)', () => {
  it('admin huỷ → hỏi Pancake trước, rồi ghi kết quả sau khi commit', async () => {
    const { svc, tx, pancakeHooks } = make(makeOrder());
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'a1' });
    expect(pancakeHooks.precheckCancel.mock.invocationCallOrder[0]).toBeLessThan(tx.order.updateMany.mock.invocationCallOrder[0]!);
    expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', { kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' });
  });

  it('Pancake đã gửi hàng → từ chối (hướng dẫn chặn giao với hãng), không lật CANCELLED, đồng bộ lại SHIPPING theo Pancake', async () => {
    const { svc, tx, pancakeHooks } = make(makeOrder({ status: 'PACKED' }), {
      precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)),
    });
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toThrow(
      /Pancake báo đã gửi hàng \(mã 2\).*chặn giao\/hoàn hàng/,
    );
    expect(tx.order.updateMany.mock.calls.map((c) => c[0].data.status)).toEqual(['SHIPPING']);
    expect(pancakeHooks.afterLocalCancel).not.toHaveBeenCalled();
  });

  it('cron hết hạn thanh toán (SYSTEM + pancakeGate) gặp đơn đã bàn giao → không huỷ, đưa vào "Cần xử lý Pancake"', async () => {
    const order = makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const { svc, prisma, pancakeHooks } = make(order, { precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)) });
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true })).rejects.toThrow();
    expect(pancakeHooks.precheckCancel).toHaveBeenCalled();
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pancakeAttention: expect.stringContaining('Hệ thống không tự huỷ được đơn') }) }),
    );
  });

  it('Pancake báo huỷ (actor PANCAKE) → không hỏi/huỷ ngược lại Pancake', async () => {
    const { svc, pancakeHooks } = make(makeOrder());
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'PANCAKE' });
    expect(pancakeHooks.precheckCancel).not.toHaveBeenCalled();
    expect(pancakeHooks.afterLocalCancel).not.toHaveBeenCalled();
  });

  it('huỷ hệ thống không cổng (Gomdon…) → không hỏi trước nhưng vẫn xếp job huỷ Pancake', async () => {
    const { svc, pancakeHooks } = make(makeOrder());
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM' });
    expect(pancakeHooks.precheckCancel).not.toHaveBeenCalled();
    expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', undefined);
  });
});

describe('OrderStatusService.markPaid → Pancake (PANCAKE-1, MONEY-1)', () => {
  it('lật PAID → xếp job báo Pancake "đã thanh toán, không thu COD"', async () => {
    const order = makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const { svc, prisma, pancakeHooks } = make(order);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ ...order, status: 'CONFIRMED', paymentStatus: 'PAID' });
    const r = await svc.markPaid('o1', { actorType: 'ADMIN', actorId: 'a1' });
    expect(r.outcome).not.toBe('ALREADY_PAID');
    expect(pancakeHooks.afterPaid).toHaveBeenCalledWith('o1');
  });
});
