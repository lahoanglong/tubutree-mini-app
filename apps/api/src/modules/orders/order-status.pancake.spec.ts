import { OrderStatusService } from './order-status.service';
import type { OrderReversalService } from './order-reversal.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { PancakeHandedOverError, PancakeUnreachableError } from '../integrations/pancake/pancake-sync-hooks';

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
    gomdonAlert: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin1' }]) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
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
    notifications as unknown as NotificationsService,
    { reverseFinancials: jest.fn().mockResolvedValue(undefined) } as unknown as OrderReversalService,
    undefined,
    undefined,
    pancakeHooks as never,
  );
  return { svc, prisma, tx, pancakeHooks, notifications };
}

describe('OrderStatusService — huỷ đơn đã lên Pancake (D1: PANCAKE-2, SELLER-3, ADMINOPS-2)', () => {
  it('admin huỷ → hỏi Pancake trước, rồi ghi kết quả sau khi commit', async () => {
    const { svc, tx, pancakeHooks } = make(makeOrder());
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'a1' });
    expect(pancakeHooks.precheckCancel.mock.invocationCallOrder[0]).toBeLessThan(tx.order.updateMany.mock.invocationCallOrder[0]!);
    expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', { kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' });
  });

  it('Pancake đã gửi hàng → admin được hướng dẫn chặn giao với hãng / trả hàng (không bảo "liên hệ CSKH"), không lật CANCELLED, đồng bộ lại SHIPPING', async () => {
    const { svc, tx, pancakeHooks } = make(makeOrder({ status: 'PACKED' }), {
      precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)),
    });
    const err = await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Pancake báo đã gửi hàng \(mã 2\).*chặn giao\/hoàn hàng/);
    expect((err as Error).message).toContain('trả hàng');
    expect((err as Error).message).not.toContain('liên hệ CSKH');
    expect(tx.order.updateMany.mock.calls.map((c) => c[0].data.status)).toEqual(['SHIPPING']);
    expect(pancakeHooks.afterLocalCancel).not.toHaveBeenCalled();
  });

  it('khách tự huỷ đơn đã bàn giao → vẫn câu "liên hệ CSKH"', async () => {
    const { svc } = make(makeOrder({ status: 'PACKED' }), { precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)) });
    await expect(svc.precheckPancakeCancel(makeOrder({ status: 'PACKED' }) as never, 'CUSTOMER')).rejects.toThrow('vui lòng liên hệ CSKH');
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

  describe('cron hết hạn thanh toán gặp đơn Pancake đã gửi hàng (R4-SYNC-5, R4-SYNC-3c)', () => {
    const unpaid = () => makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const handedOver = () => ({ precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)) });
    const attention = (m: jest.Mock) =>
      m.mock.calls.map((c) => c[0].data?.pancakeAttention).filter((a): a is string => typeof a === 'string');

    it('lần đầu → ghi mốc thôi tự huỷ, nhắc "Cần xử lý Pancake" kèm lối ra rõ ràng, báo admin in-app', async () => {
      const { svc, prisma, notifications } = make(unpaid(), handedOver());
      await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true })).rejects.toThrow();
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', autoCancelBlockedAt: null },
        data: { autoCancelBlockedAt: expect.any(Date) },
      });
      const [reason] = attention(prisma.order.updateMany);
      expect(reason).toContain('Hệ thống không tự huỷ được đơn');
      expect(reason).toContain('"Đã nhận tiền"');
      expect(reason).toContain('"Đã hoàn"');
      expect(notifications.notify).toHaveBeenCalledWith('admin1', 'OPS_PANCAKE_ALERT', expect.objectContaining({ order_code: 'TUBU1' }));
    });

    it('đã có mốc (lượt cron trước đã nhắc) → không nhắc lại, không báo lại dù admin đã gỡ nhắc', async () => {
      const { svc, prisma, notifications } = make(unpaid(), handedOver());
      prisma.order.updateMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ({
        count: 'autoCancelBlockedAt' in where ? 0 : 1,
      }));
      await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true })).rejects.toThrow();
      expect(attention(prisma.order.updateMany)).toEqual([]);
      expect(notifications.notify).not.toHaveBeenCalledWith(expect.anything(), 'OPS_PANCAKE_ALERT', expect.anything());
    });
  });

  describe('không hỏi được Pancake (R3-CANCEL-1, R2-PANCAKE-1)', () => {
    const unreachable = () => jest.fn().mockRejectedValue(new PancakeUnreachableError('timeout of 5000ms exceeded'));

    it('CSKH/admin huỷ → 409 "Kho chưa phản hồi…" kèm hướng dẫn, KHÔNG lật CANCELLED, KHÔNG hoàn tiền', async () => {
      const { svc, tx, pancakeHooks } = make(makeOrder(), { precheckCancel: unreachable() });
      const err = (await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'cskh' }).catch((e: unknown) => e)) as {
        getStatus(): number;
        getResponse(): { code: string; message: string };
      };
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse().code).toBe('PANCAKE_UNREACHABLE');
      expect(err.getResponse().message).toMatch(/^Kho chưa phản hồi, vui lòng thử lại sau ít phút — đơn TUBU1 .*CHƯA huỷ/);
      expect(pancakeHooks.precheckCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }), 'INTERACTIVE');
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(pancakeHooks.afterLocalCancel).not.toHaveBeenCalled();
    });

    it('khách tự huỷ → đúng câu "Kho chưa phản hồi, vui lòng thử lại sau ít phút"', async () => {
      const { svc, pancakeHooks } = make(makeOrder(), { precheckCancel: unreachable() });
      await expect(svc.precheckPancakeCancel(makeOrder() as never, 'CUSTOMER')).rejects.toThrow(/^Kho chưa phản hồi, vui lòng thử lại sau ít phút$/);
      expect(pancakeHooks.precheckCancel).toHaveBeenCalledWith(expect.anything(), 'INTERACTIVE');
    });

    it('cron hết hạn thanh toán hỏi ở chế độ BACKGROUND (được hoãn, không treo mẻ)', async () => {
      const order = makeOrder({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
      const { svc, pancakeHooks } = make(order, { precheckCancel: jest.fn().mockResolvedValue({ kind: 'DEFERRED', reason: 'timeout' }) });
      await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true });
      expect(pancakeHooks.precheckCancel).toHaveBeenCalledWith(expect.anything(), 'BACKGROUND');
      expect(pancakeHooks.afterLocalCancel).toHaveBeenCalledWith('o1', { kind: 'DEFERRED', reason: 'timeout' });
    });
  });

  it.each([
    ['CANCELLED', 'CONFIRMED'],
    ['RETURNED', 'DELIVERED'],
  ])('đơn chuyển %s → đóng báo động Gomdon "hàng đã hoàn về kho" và gỡ việc Pancake "HUỶ sau bàn giao"/"ĐANG HOÀN" (R3-CANCEL-3)', async (to, from) => {
    const { svc, prisma } = make(makeOrder({ status: from, pancakeOrderId: null, paymentStatus: 'UNPAID', paymentMethod: 'COD' }));
    await svc.setStatus('o1', to as never, { actorType: 'ADMIN' });
    expect(prisma.gomdonAlert.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', resolvedAt: null, kind: { in: ['GOODS_RETURNED'] } },
      data: { resolvedAt: expect.any(Date), resolvedById: null },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'o1',
        OR: [
          { pancakeAttention: { startsWith: 'Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển' } },
          { pancakeAttention: { startsWith: 'Pancake báo ĐANG HOÀN' } },
        ],
      },
      data: { pancakeAttention: null, pancakeAttentionAt: null },
    });
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
