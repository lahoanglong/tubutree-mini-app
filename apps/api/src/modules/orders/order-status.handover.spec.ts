import { OrderStatusService } from './order-status.service';
import { CancelAfterHandoverError, InvalidOrderTransitionError } from './order-transition';
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
    status: 'SHIPPING',
    note: null,
    total: 300000,
    paymentMethod: 'WALLET',
    paymentStatus: 'PAID',
    fulfiller: 'TUBU',
    shippingCode: 'BEX100600777',
    shippingPartner: 'BestExpress',
    shippedAt: null,
    hasRecyclingPickup: false,
    gomdonStatus: null,
    gomdonOrderId: null,
    gomdonPartnerCode: null,
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
  const reversal = { reverseFinancials: jest.fn().mockResolvedValue(undefined) };
  const pancakeHooks = {
    precheckCancel: jest.fn().mockResolvedValue({ kind: 'DEFERRED', reason: 'Pancake vừa không phản hồi' }),
    afterLocalCancel: jest.fn().mockResolvedValue(undefined),
    afterPaid: jest.fn().mockResolvedValue(undefined),
    ...hooks,
  };
  const svc = new OrderStatusService(
    prisma as unknown as PrismaService,
    { creditOrderPoints: jest.fn(), reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService,
    { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } as unknown as AffiliateService,
    { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService,
    reversal as unknown as OrderReversalService,
    undefined,
    undefined,
    pancakeHooks as never,
  );
  return { svc, prisma, tx, reversal, pancakeHooks };
}

describe('OrderStatusService — D1: không huỷ sau khi bàn giao vận chuyển (R2-ADMINOPS-1, R2-PANCAKE-1, R2-GOMDON-2)', () => {
  it('admin/CSKH/kho huỷ đơn Tubu đang giao lúc Pancake không trả lời → từ chối, không hỏi Pancake, không hoàn tiền', async () => {
    const { svc, tx, reversal, pancakeHooks } = make(makeOrder());
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN', actorId: 'cskh' })).rejects.toBeInstanceOf(
      CancelAfterHandoverError,
    );
    expect(pancakeHooks.precheckCancel).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
  });

  it('lời từ chối cho người vận hành nói rõ đã bàn giao và hướng xử lý (không bảo "liên hệ CSKH")', async () => {
    const { svc } = make(makeOrder());
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toThrow(
      /TUBU1 đã bàn giao vận chuyển \(đơn đang giao\).*chặn giao\/hoàn hàng/,
    );
  });

  it('đơn gian hàng tự giao đã SHIPPING (có mã GHN) → admin không huỷ được', async () => {
    const { svc, tx } = make(
      makeOrder({ fulfiller: 'MERCHANT', shippingCode: 'GHN-MERCH-1', shippingPartner: 'GHN', shippedAt: new Date() }),
    );
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toBeInstanceOf(CancelAfterHandoverError);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('đơn PACKED đã có mã vận đơn hãng → nhà bán/admin không huỷ được', async () => {
    const { svc, tx } = make(makeOrder({ status: 'PACKED' }));
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'MERCHANT' })).rejects.toBeInstanceOf(CancelAfterHandoverError);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('đơn thu gom: bưu tá Gomdon đã lấy hàng → admin không huỷ/hoàn tiền/cộng kho', async () => {
    const order = makeOrder({
      paymentMethod: 'BANK_TRANSFER',
      hasRecyclingPickup: true,
      gomdonOrderId: '9005',
      gomdonPartnerCode: 'BEX9005',
      shippingCode: 'BEX9005',
      gomdonStatus: '3',
      status: 'CONFIRMED',
    });
    const { svc, reversal } = make(order);
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' })).rejects.toThrow(
      /bưu tá Gomdon\/BestExpress đã lấy hàng/,
    );
    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
  });

  it('Pancake báo huỷ (status 6) đơn đã bàn giao → ném lỗi chuyển trạng thái để webhook đưa vào "Cần xử lý", không hoàn tiền', async () => {
    const order = makeOrder({
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      hasRecyclingPickup: true,
      gomdonOrderId: '5',
      gomdonPartnerCode: 'B5',
      shippingCode: 'B5',
      gomdonStatus: '4',
    });
    const { svc, tx, reversal } = make(order);
    const err = await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'PANCAKE' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancelAfterHandoverError);
    expect(err).toBeInstanceOf(InvalidOrderTransitionError);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(reversal.reverseFinancials).not.toHaveBeenCalled();
  });

  it('cron/hệ thống gặp đơn đã bàn giao → không huỷ, đưa vào "Cần xử lý Pancake"', async () => {
    const { svc, prisma, tx } = make(makeOrder({ status: 'PACKED' }));
    await expect(svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'SYSTEM', pancakeGate: true })).rejects.toBeInstanceOf(
      CancelAfterHandoverError,
    );
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pancakeAttention: expect.stringContaining('không huỷ được nữa') }) }),
    );
  });

  it('hàng đã hoàn về (Pancake "Đã hoàn" / gian hàng báo giao không thành) → returnedToSender cho huỷ + hoàn tiền', async () => {
    const pancake = make(makeOrder());
    await pancake.svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'PANCAKE', returnedToSender: true });
    expect(pancake.reversal.reverseFinancials).toHaveBeenCalled();

    const merchant = make(makeOrder({ fulfiller: 'MERCHANT', shippedAt: new Date() }));
    await merchant.svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'MERCHANT', returnedToSender: true });
    expect(merchant.reversal.reverseFinancials).toHaveBeenCalled();
  });

  it('Gomdon báo đã hoàn hàng về kho (8) → admin huỷ + hoàn tiền được dù đơn còn SHIPPING', async () => {
    const order = makeOrder({
      hasRecyclingPickup: true,
      gomdonOrderId: '9',
      gomdonPartnerCode: 'B9',
      shippingCode: 'B9',
      gomdonStatus: '8',
      pancakeOrderId: null,
    });
    const { svc, reversal } = make(order);
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' });
    expect(reversal.reverseFinancials).toHaveBeenCalled();
  });

  it('chưa bàn giao (PACKED, chưa mã vận đơn), Pancake không trả lời → vẫn huỷ như trước (trạng thái cuối biết được là chưa giao)', async () => {
    const { svc, reversal, pancakeHooks } = make(makeOrder({ status: 'PACKED', shippingCode: null, shippingPartner: null }));
    await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' });
    expect(pancakeHooks.precheckCancel).toHaveBeenCalled();
    expect(reversal.reverseFinancials).toHaveBeenCalled();
  });

  it('Pancake báo đã gửi hàng khi admin huỷ → lời báo cho người vận hành, không phải "liên hệ CSKH" (R2-LIFECYCLE-9)', async () => {
    const { svc } = make(makeOrder({ status: 'PACKED', shippingCode: null }), {
      precheckCancel: jest.fn().mockRejectedValue(new PancakeHandedOverError(2)),
    });
    const err = (await svc.setStatus('o1', 'CANCELLED' as never, { actorType: 'ADMIN' }).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('liên hệ CSKH');
    expect(err.message).toContain('Pancake báo đã gửi hàng (mã 2)');
  });
});
